/**
 * Slice 12d: categories. The user's categories are rules (a name and a
 * one-line description); a decision model sorts inbox items (and, if asked,
 * the Library) into them, many items per call with one `choice` question per
 * item. A text model only drafts categories, on demand, from what's in the
 * app; nothing changes until the user saves.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { stripTags } from '../feeds/parse';
import {
	categories,
	categorySettings,
	feedEntries,
	itemCategories,
	linkArchives,
	links,
	type Db
} from '../db';
import { decide, estimateCall, type AiRunner, type Question } from './decide';
import { estimateNeurons, estimateTokens, type DecisionModel } from './models';
import { firstWords } from './state';
import { DEFAULT_TEXT_MODEL, generateJson, textNeurons } from './text';
import { reserveNeurons, settleNeurons } from './usage';

export const CATEGORY_MODEL: DecisionModel = 'clef-flash';
export const OTHER = 'other';
/** A second category is shown when the model gives it at least this much. */
export const SECONDARY_MIN = 0.35;
/** Items per decision call: one question each (the API allows 64). */
export const BATCH_SIZE = 20;
/** Items categorized per run of the fetcher's cron, per user. */
export const PER_RUN = 10;
const MAX_CATEGORIES = 30;
const ITEM_WORDS = 120;
const POST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface CategoryDraft {
	slug?: string;
	name: string;
	description: string;
}
export interface CategoryDef {
	slug: string;
	name: string;
	description: string;
}

export class CategoryError extends Error {}
export class BudgetError extends Error {
	constructor() {
		super('Today’s AI budget is spent; try again tomorrow.');
	}
}

/** A slug the model API accepts as an option id: lowercase letters, digits and dashes. */
export function slugify(name: string): string {
	const slug = name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/, '');
	return slug || 'category';
}

/**
 * Cleans up a draft: trims, drops empty rows, gives each a unique slug (keeping
 * an existing one when it's still valid), and enforces the limits. "Other" is
 * implicit, so a category can't take that slug.
 */
export function normalizeDraft(draft: CategoryDraft[]): CategoryDef[] {
	const seen = new Set<string>([OTHER]);
	const out: CategoryDef[] = [];
	for (const row of draft) {
		const name = String(row.name ?? '')
			.trim()
			.slice(0, 40);
		const description = String(row.description ?? '')
			.trim()
			.slice(0, 300);
		if (!name) continue;
		if (!description) throw new CategoryError(`Describe what belongs in “${name}”.`);
		let slug = row.slug && /^[a-z0-9-]{1,40}$/.test(row.slug) ? row.slug : slugify(name);
		for (let i = 2; seen.has(slug); i++) slug = `${slugify(name).slice(0, 36)}-${i}`;
		seen.add(slug);
		out.push({ slug, name, description });
	}
	if (out.length > MAX_CATEGORIES) {
		throw new CategoryError(`Keep it to ${MAX_CATEGORIES} categories or fewer.`);
	}
	return out;
}

const otherDef: CategoryDef = {
	slug: OTHER,
	name: 'Other',
	description: 'Anything that fits none of the other categories'
};

/** Reserves the estimate, runs the call, and settles from what it reports (or refunds it). */
async function spend<T>(
	db: Db,
	cap: number,
	estimate: number,
	run: () => Promise<{ value: T; actual: number | null }>,
	now = new Date()
): Promise<T> {
	if (!(await reserveNeurons(db, estimate, cap, now))) throw new BudgetError();
	try {
		const { value, actual } = await run();
		if (actual !== null) await settleNeurons(db, estimate, actual, now);
		return value;
	} catch (err) {
		await settleNeurons(db, estimate, 0, now);
		throw err;
	}
}

// ── Sorting items into categories ────────────────────────────────────────────

export interface ItemText {
	kind: 'post' | 'link';
	id: string;
	title: string;
	source: string;
	text: string | null;
}

export interface Placement {
	primary: string;
	secondary: string | null;
	probabilities: Record<string, number>;
}

/** The state for a batch: the categories (as rules), the user's corrections, then the items. */
export function formatBatchState(
	defs: CategoryDef[],
	examples: { title: string; category: string }[],
	items: ItemText[]
): string {
	const lines = [
		'# Categories',
		...[...defs, otherDef].map((d) => `- ${d.name}: ${d.description}`)
	];
	if (examples.length) {
		lines.push('', '# How this reader has categorized items themselves');
		for (const e of examples) lines.push(`- “${e.title}” → ${e.category}`);
	}
	lines.push('', '# Items');
	items.forEach((item, i) => {
		lines.push('', `[${i + 1}] ${item.title} (${item.source})`);
		if (item.text) lines.push(firstWords(item.text, ITEM_WORDS));
	});
	return lines.join('\n');
}

function batchQuestions(defs: CategoryDef[], count: number): Record<string, Question> {
	const options = Object.fromEntries(
		[...defs, otherDef].map((d) => [d.slug, `${d.name}: ${d.description}`])
	);
	return Object.fromEntries(
		Array.from({ length: count }, (_, i) => [
			`item_${i + 1}`,
			{
				type: 'choice',
				instructions: `Which category best fits item [${i + 1}]?`,
				options
			} satisfies Question
		])
	);
}

/** The top category, and a second when it's also likely. */
export function placement(probabilities: Record<string, number>, choice?: string): Placement {
	const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
	const primary = choice ?? ranked[0]?.[0] ?? OTHER;
	const second = ranked.find(([slug]) => slug !== primary);
	return {
		primary,
		secondary: second && second[1] >= SECONDARY_MIN && second[0] !== OTHER ? second[0] : null,
		probabilities
	};
}

/**
 * Sorts items into categories, BATCH_SIZE per call, under the daily cap.
 * Returns a placement per item id (an item the model gave no readable answer
 * for is left out).
 */
export async function categorizeItems(
	db: Db,
	ai: AiRunner,
	defs: CategoryDef[],
	examples: { title: string; category: string }[],
	items: ItemText[],
	{
		cap,
		model = CATEGORY_MODEL,
		now = new Date()
	}: { cap: number; model?: DecisionModel; now?: Date }
): Promise<Map<string, Placement>> {
	const out = new Map<string, Placement>();
	for (let i = 0; i < items.length; i += BATCH_SIZE) {
		const batch = items.slice(i, i + BATCH_SIZE);
		const state = formatBatchState(defs, examples, batch);
		const questions = batchQuestions(defs, batch.length);
		const answers = await spend(
			db,
			cap,
			estimateCall(model, state, questions).neurons,
			async () => {
				const { answers, inputTokens } = await decide(ai, model, state, questions);
				return {
					value: answers,
					actual: inputTokens === null ? null : estimateNeurons(model, inputTokens)
				};
			},
			now
		);
		batch.forEach((item, j) => {
			const a = answers[`item_${j + 1}`];
			if (a?.type === 'choice')
				out.set(`${item.kind}:${item.id}`, placement(a.probabilities, a.choice));
		});
	}
	return out;
}

// ── Reading and writing the user's categories ───────────────────────────────

export async function listCategories(db: Db, userId: string): Promise<CategoryDef[]> {
	return db
		.select({ slug: categories.slug, name: categories.name, description: categories.description })
		.from(categories)
		.where(eq(categories.userId, userId))
		.orderBy(asc(categories.position), asc(categories.name));
}

export async function getCategorySettings(db: Db, userId: string) {
	const row = await db.query.categorySettings.findFirst({
		where: eq(categorySettings.userId, userId)
	});
	return { includeLibrary: row?.includeLibrary ?? false };
}

/**
 * Replaces the user's categories. The model's placements are cleared so every
 * item is sorted again under the new rules; corrections stay unless their
 * category is gone.
 */
export async function saveCategories(
	db: Db,
	userId: string,
	draft: CategoryDraft[],
	{ includeLibrary }: { includeLibrary: boolean }
): Promise<CategoryDef[]> {
	const defs = normalizeDraft(draft);
	const now = new Date();
	const keep = [...defs.map((d) => d.slug), OTHER];
	await db.batch([
		db.delete(categories).where(eq(categories.userId, userId)),
		// One statement per category keeps each under D1's 100-parameter limit.
		...defs.map((d, position) =>
			db.insert(categories).values({ ...d, userId, position, createdAt: now })
		),
		db
			.insert(categorySettings)
			.values({ userId, includeLibrary, updatedAt: now })
			.onConflictDoUpdate({
				target: categorySettings.userId,
				set: { includeLibrary, updatedAt: now }
			}),
		db.delete(itemCategories).where(
			and(
				eq(itemCategories.userId, userId),
				sql`(${itemCategories.corrected} = 0 or ${itemCategories.primarySlug} not in (${sql.join(
					keep.map((k) => sql`${k}`),
					sql`, `
				)}))`
			)
		)
	]);
	return defs;
}

/** A correction from the user: this item belongs in that category (or "other"). */
export async function setItemCategory(
	db: Db,
	userId: string,
	kind: 'post' | 'link',
	itemId: string,
	slug: string
) {
	const valid = slug === OTHER || (await listCategories(db, userId)).some((c) => c.slug === slug);
	if (!valid) throw new CategoryError('That category doesn’t exist any more.');
	const values = {
		primarySlug: slug,
		secondarySlug: null,
		probabilities: null,
		corrected: true,
		updatedAt: new Date()
	};
	await db
		.insert(itemCategories)
		.values({ userId, itemKind: kind, itemId, ...values })
		.onConflictDoUpdate({
			target: [itemCategories.userId, itemCategories.itemKind, itemCategories.itemId],
			set: values
		});
}

/** Categories of these items, keyed `kind:id`. */
export async function categoriesFor(
	db: Db,
	userId: string,
	items: { kind: 'post' | 'link'; id: string }[]
) {
	const out = new Map<string, { slugs: string[]; corrected: boolean }>();
	for (const kind of ['post', 'link'] as const) {
		const ids = items.filter((i) => i.kind === kind).map((i) => i.id);
		// D1 allows 100 bound parameters per statement.
		for (let i = 0; i < ids.length; i += 90) {
			const rows = await db
				.select()
				.from(itemCategories)
				.where(
					and(
						eq(itemCategories.userId, userId),
						eq(itemCategories.itemKind, kind),
						inArray(itemCategories.itemId, ids.slice(i, i + 90))
					)
				);
			for (const r of rows) {
				out.set(`${kind}:${r.itemId}`, {
					slugs: [r.primarySlug, ...(r.secondarySlug ? [r.secondarySlug] : [])],
					corrected: r.corrected
				});
			}
		}
	}
	return out;
}

/** The user's recent corrections, as examples for the model. */
export async function correctionExamples(db: Db, userId: string, limit = 10) {
	return db.all<{ title: string; category: string }>(sql`
		select coalesce(fe.title, l.title, l.url) as title,
			coalesce(c.name, 'Other') as category
		from item_categories ic
		left join feed_entries fe on ic.item_kind = 'post' and fe.id = ic.item_id
		left join links l on ic.item_kind = 'link' and l.id = ic.item_id
		left join categories c on c.user_id = ic.user_id and c.slug = ic.primary_slug
		where ic.user_id = ${userId} and ic.corrected = 1
			and coalesce(fe.title, l.title, l.url) is not null
		order by ic.updated_at desc
		limit ${limit}`);
}

// ── What gets categorized ────────────────────────────────────────────────────

/** Users with categories, so the fetcher knows whom to categorize for. */
export async function usersWithCategories(db: Db): Promise<string[]> {
	const rows = await db.selectDistinct({ userId: categories.userId }).from(categories);
	return rows.map((r) => r.userId);
}

/**
 * Items without a category, newest first: unread posts from the last week,
 * Shared links, and (if the user asked) starred links.
 */
export async function categorizeCandidates(
	db: Db,
	userId: string,
	limit: number,
	{ includeLibrary, now = Date.now() }: { includeLibrary: boolean; now?: number }
): Promise<{ kind: 'post' | 'link'; id: string }[]> {
	const none = (kind: string, id: unknown) => sql`
		not exists (select 1 from item_categories ic
			where ic.user_id = ${userId} and ic.item_kind = ${kind} and ic.item_id = ${id})`;
	const rows = await db.all<{ kind: 'post' | 'link'; id: string }>(sql`
		select kind, id from (
			select 'post' as kind, fe.id as id, coalesce(fe.published_at, fe.created_at) as d
			from feed_entries fe
			join subscriptions s on s.feed_id = fe.feed_id and s.user_id = ${userId}
			left join entry_state es on es.entry_id = fe.id and es.user_id = ${userId}
			where es.read_at is null and es.dismissed_at is null
				and fe.created_at >= ${now - POST_WINDOW_MS}
				and ${none('post', sql`fe.id`)}
			union all
			select 'link', l.id, l.queued_at
			from links l
			where l.user_id = ${userId}
				and (l.status = 'queued' ${includeLibrary ? sql`or l.is_reference = 1` : sql``})
				and ${none('link', sql`l.id`)}
		)
		order by d desc
		limit ${limit}`);
	return rows;
}

/** Titles and text of items, for the model. Items that are gone are left out. */
export async function loadItemTexts(
	db: Db,
	userId: string,
	items: { kind: 'post' | 'link'; id: string }[]
): Promise<ItemText[]> {
	const postIds = items.filter((i) => i.kind === 'post').map((i) => i.id);
	const linkIds = items.filter((i) => i.kind === 'link').map((i) => i.id);
	const posts = postIds.length
		? await db.all<{ id: string; title: string | null; body: string | null; source: string }>(sql`
				select fe.id, fe.title, coalesce(fe.content, fe.summary) as body,
					coalesce(s.title_override, f.title, f.url) as source
				from feed_entries fe
				join feeds f on f.id = fe.feed_id
				left join subscriptions s on s.feed_id = f.id and s.user_id = ${userId}
				where fe.id in (${sql.join(
					postIds.map((id) => sql`${id}`),
					sql`, `
				)})`)
		: [];
	const linkRows = linkIds.length
		? await db
				.select({ link: links, text: linkArchives.text })
				.from(links)
				.leftJoin(linkArchives, eq(linkArchives.linkId, links.id))
				.where(and(eq(links.userId, userId), inArray(links.id, linkIds)))
		: [];
	const byKey = new Map<string, ItemText>();
	for (const p of posts) {
		byKey.set(`post:${p.id}`, {
			kind: 'post',
			id: p.id,
			title: p.title ?? 'Untitled',
			source: p.source,
			text: p.body ? stripTags(p.body) : null
		});
	}
	for (const { link, text } of linkRows) {
		byKey.set(`link:${link.id}`, {
			kind: 'link',
			id: link.id,
			title: link.title ?? link.url,
			source: link.siteName ?? new URL(link.url).hostname,
			text: [link.note, text ?? link.description].filter(Boolean).join('\n') || null
		});
	}
	return items.map((i) => byKey.get(`${i.kind}:${i.id}`)).filter((i): i is ItemText => !!i);
}

/**
 * The fetcher's job: categorizes up to PER_RUN of the user's uncategorized
 * items in one call, and stores the placements.
 */
export async function categorizeForUser(
	db: Db,
	ai: AiRunner,
	userId: string,
	{ cap, now = new Date() }: { cap: number; now?: Date }
): Promise<{ status: 'none' | 'done' | 'capped'; categorized: number }> {
	const defs = await listCategories(db, userId);
	if (!defs.length) return { status: 'none', categorized: 0 };
	const settings = await getCategorySettings(db, userId);
	const candidates = await categorizeCandidates(db, userId, PER_RUN, {
		...settings,
		now: now.getTime()
	});
	if (!candidates.length) return { status: 'none', categorized: 0 };
	const items = await loadItemTexts(db, userId, candidates);
	let placed: Map<string, Placement>;
	try {
		placed = await categorizeItems(db, ai, defs, await correctionExamples(db, userId), items, {
			cap,
			now
		});
	} catch (err) {
		if (err instanceof BudgetError) return { status: 'capped', categorized: 0 };
		throw err;
	}
	const known = new Set([...defs.map((d) => d.slug), OTHER]);
	const rows = items
		.map((item) => ({ item, p: placed.get(`${item.kind}:${item.id}`) }))
		.filter(({ p }) => p && known.has(p.primary))
		.map(({ item, p }) => ({
			userId,
			itemKind: item.kind,
			itemId: item.id,
			primarySlug: p!.primary,
			secondarySlug: p!.secondary && known.has(p!.secondary) ? p!.secondary : null,
			probabilities: JSON.stringify(p!.probabilities),
			corrected: false,
			updatedAt: now
		}));
	// One statement per row keeps each under D1's 100-parameter limit.
	for (const row of rows) {
		await db.insert(itemCategories).values(row).onConflictDoNothing();
	}
	return { status: 'done', categorized: rows.length };
}

// ── Suggest and Check ───────────────────────────────────────────────────────

export interface Suggestion {
	name: string;
	description: string;
	examples: string[];
}

const SUGGEST_SCHEMA = {
	type: 'object',
	properties: {
		categories: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					name: { type: 'string' },
					description: { type: 'string' },
					examples: { type: 'array', items: { type: 'string' } }
				},
				required: ['name', 'description']
			}
		}
	},
	required: ['categories']
};

/** What the text model is shown: the user's feeds, recent titles, starred titles and tags. */
export async function suggestionSample(db: Db, userId: string) {
	const [feedRows, posts, starred, tagRows, current, others] = await Promise.all([
		db.all<{ name: string; folder: string | null }>(sql`
			select coalesce(s.title_override, f.title, f.url) as name, s.folder as folder
			from subscriptions s join feeds f on f.id = s.feed_id
			where s.user_id = ${userId} order by name`),
		db.all<{ title: string; source: string; summary: string | null }>(sql`
			select fe.title as title, coalesce(s.title_override, f.title, f.url) as source,
				fe.summary as summary
			from feed_entries fe
			join subscriptions s on s.feed_id = fe.feed_id and s.user_id = ${userId}
			join feeds f on f.id = fe.feed_id
			where fe.title is not null
			order by coalesce(fe.published_at, fe.created_at) desc limit 120`),
		db.all<{ title: string; source: string }>(sql`
			select coalesce(title, url) as title, coalesce(site_name, '') as source
			from links where user_id = ${userId} and is_reference = 1
			order by starred_at desc limit 50`),
		db.all<{ name: string }>(sql`
			select t.name as name from tags t join link_tags lt on lt.tag_id = t.id
			where t.user_id = ${userId} group by t.id order by count(*) desc limit 40`),
		listCategories(db, userId),
		db.all<{ title: string }>(sql`
			select coalesce(fe.title, l.title, l.url) as title
			from item_categories ic
			left join feed_entries fe on ic.item_kind = 'post' and fe.id = ic.item_id
			left join links l on ic.item_kind = 'link' and l.id = ic.item_id
			where ic.user_id = ${userId} and ic.primary_slug = ${OTHER}
				and coalesce(fe.title, l.title, l.url) is not null
			order by ic.updated_at desc limit 30`)
	]);
	return { feeds: feedRows, posts, starred, tags: tagRows.map((t) => t.name), current, others };
}

function suggestionPrompt(
	sample: Awaited<ReturnType<typeof suggestionSample>>,
	corrections: { title: string; category: string }[]
) {
	const lines = ['# Feeds they follow (folder in brackets)'];
	for (const f of sample.feeds) lines.push(`- ${f.name}${f.folder ? ` [${f.folder}]` : ''}`);
	lines.push('', '# Recent posts from those feeds');
	for (const p of sample.posts) {
		const gist = p.summary ? ` — ${firstWords(stripTags(p.summary), 15)}` : '';
		lines.push(`- ${p.title} (${p.source})${gist}`);
	}
	lines.push('', '# Articles they starred to keep (these matter most)');
	for (const s of sample.starred) lines.push(`- ${s.title}${s.source ? ` (${s.source})` : ''}`);
	if (sample.tags.length) lines.push('', `# Their tags: ${sample.tags.join(', ')}`);
	if (sample.current.length) {
		lines.push('', '# Their current categories');
		for (const c of sample.current) lines.push(`- ${c.name}: ${c.description}`);
		if (sample.others.length) {
			lines.push('', '# Recent items that fit none of them (put in Other)');
			for (const o of sample.others) lines.push(`- ${o.title}`);
		}
		if (corrections.length) {
			lines.push('', '# Items they moved to a different category by hand');
			for (const c of corrections) lines.push(`- “${c.title}” → ${c.category}`);
		}
		lines.push(
			'',
			'Revise their categories: keep the ones that work (same names), and propose splits, merges or additions where the items above call for them. Return the full revised list.'
		);
	} else {
		lines.push('', 'Propose 5 to 12 categories that would sort this reading well.');
	}
	lines.push(
		'',
		'Rules: names are 1 to 3 words. Each description is one sentence that says what belongs, written as a rule another program will use to sort new articles (name places, teams, fields or genres when the reading makes them clear, e.g. which city “Local” means). Don’t propose an “Other” category; it always exists. Give 2 or 3 example titles from above for each.'
	);
	return lines.join('\n');
}

/** Drafts categories with the text model. Nothing is saved. */
export async function suggestCategories(
	db: Db,
	ai: AiRunner,
	userId: string,
	{ cap, model = DEFAULT_TEXT_MODEL, now = new Date() }: { cap: number; model?: string; now?: Date }
): Promise<Suggestion[]> {
	const sample = await suggestionSample(db, userId);
	if (!sample.posts.length && !sample.starred.length) {
		throw new CategoryError('There isn’t enough reading here yet to suggest categories from.');
	}
	const system =
		'You organize one person’s reading into a small set of clear, non-overlapping categories. Reply with JSON only.';
	const prompt = suggestionPrompt(sample, await correctionExamples(db, userId, 20));
	const maxTokens = 1500;
	const estimate = textNeurons(model, estimateTokens(system + prompt), maxTokens);
	const json = await spend(
		db,
		cap,
		estimate,
		async () => {
			const r = await generateJson(ai, model, {
				system,
				prompt,
				schema: SUGGEST_SCHEMA,
				maxTokens
			});
			return {
				value: r.json,
				actual:
					r.inputTokens === null || r.outputTokens === null
						? null
						: textNeurons(model, r.inputTokens, r.outputTokens)
			};
		},
		now
	);
	const list = (json as { categories?: unknown })?.categories;
	if (!Array.isArray(list))
		throw new CategoryError('The suggestion came back in an unexpected shape.');
	const out: Suggestion[] = [];
	for (const c of list) {
		const name = typeof c?.name === 'string' ? c.name.trim().slice(0, 40) : '';
		const description =
			typeof c?.description === 'string' ? c.description.trim().slice(0, 300) : '';
		if (!name || !description || slugify(name) === OTHER) continue;
		const examples = Array.isArray(c.examples)
			? c.examples.filter((e: unknown): e is string => typeof e === 'string').slice(0, 3)
			: [];
		out.push({ name, description, examples });
	}
	if (!out.length) throw new CategoryError('The suggestion came back empty. Try again.');
	return out.slice(0, MAX_CATEGORIES);
}

export interface CheckReport {
	sampled: number;
	categories: { slug: string; name: string; count: number; examples: string[] }[];
	other: { count: number; examples: string[] };
	/** Top pick under 0.5: the model wasn't sure. */
	unsure: number;
	/** Pairs the model often couldn't separate (second pick within 0.2 of the first). */
	confused: { a: string; b: string; count: number }[];
}

/** Summarizes how a draft sorted the sample. Pure, for testing. */
export function summarizeCheck(
	defs: CategoryDef[],
	items: ItemText[],
	placed: Map<string, Placement>
): CheckReport {
	const name = new Map([...defs, otherDef].map((d) => [d.slug, d.name]));
	const groups = new Map<string, string[]>();
	const pairs = new Map<string, number>();
	let unsure = 0;
	let sampled = 0;
	for (const item of items) {
		const p = placed.get(`${item.kind}:${item.id}`);
		if (!p) continue;
		sampled++;
		groups.set(p.primary, [...(groups.get(p.primary) ?? []), item.title]);
		const ranked = Object.entries(p.probabilities).sort((a, b) => b[1] - a[1]);
		if ((ranked[0]?.[1] ?? 0) < 0.5) unsure++;
		if (ranked[1] && ranked[0][1] - ranked[1][1] < 0.2) {
			const key = [ranked[0][0], ranked[1][0]].sort().join('|');
			pairs.set(key, (pairs.get(key) ?? 0) + 1);
		}
	}
	return {
		sampled,
		categories: defs.map((d) => ({
			slug: d.slug,
			name: d.name,
			count: groups.get(d.slug)?.length ?? 0,
			examples: (groups.get(d.slug) ?? []).slice(0, 3)
		})),
		other: {
			count: groups.get(OTHER)?.length ?? 0,
			examples: (groups.get(OTHER) ?? []).slice(0, 5)
		},
		unsure,
		confused: [...pairs]
			.filter(([, n]) => n >= 2)
			.map(([key, count]) => {
				const [a, b] = key.split('|');
				return { a: name.get(a) ?? a, b: name.get(b) ?? b, count };
			})
			.sort((x, y) => y.count - x.count)
	};
}

/** A mixed sample to check a draft against: recent posts and starred links. */
async function checkSample(db: Db, userId: string): Promise<ItemText[]> {
	const rows = await db.all<{ kind: 'post' | 'link'; id: string }>(sql`
		select * from (
			select 'post' as kind, fe.id as id from feed_entries fe
			join subscriptions s on s.feed_id = fe.feed_id and s.user_id = ${userId}
			order by coalesce(fe.published_at, fe.created_at) desc limit 25
		)
		union all
		select * from (
			select 'link', id from links where user_id = ${userId} and is_reference = 1
			order by starred_at desc limit 15
		)`);
	return loadItemTexts(db, userId, rows);
}

/** Sorts a sample with a draft (nothing is saved) and reports how it went. */
export async function checkCategories(
	db: Db,
	ai: AiRunner,
	userId: string,
	draft: CategoryDraft[],
	{ cap, now = new Date() }: { cap: number; now?: Date }
): Promise<CheckReport> {
	const defs = normalizeDraft(draft);
	if (!defs.length) throw new CategoryError('Add at least one category to check.');
	const items = await checkSample(db, userId);
	if (!items.length) throw new CategoryError('There’s nothing to check against yet.');
	const placed = await categorizeItems(db, ai, defs, await correctionExamples(db, userId), items, {
		cap,
		now
	});
	return summarizeCheck(defs, items, placed);
}
