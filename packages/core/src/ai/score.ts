/**
 * Slice 12c: predicts, for each new item in a user's inbox, the chance they
 * open it and the chance they star it, with a decision model on Workers AI.
 * The fetcher picks candidates on its cron and scores each in its own
 * invocation (a cold model can take close to a minute to answer).
 */
import { and, eq, sql } from 'drizzle-orm';
import { stripTags } from '../feeds/parse';
import {
	feedEntries,
	feeds,
	linkArchives,
	links,
	predictions,
	subscriptions,
	type Db
} from '../db';
import { decide, estimateCall, type AiRunner } from './decide';
import { estimateNeurons, type DecisionModel } from './models';
import { loadProfile } from './profile';
import { formatState, QUESTIONS, type ItemForModel } from './state';
import { reserveNeurons, settleNeurons } from './usage';

export const SCORE_MODEL: DecisionModel = 'clef-flash';
/** Only posts this recent are scored; older unread ones aren't news to rank. */
const POST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** A shared link waits this long for its readable copy before it's scored without one. */
const COPY_WAIT_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 60 * 60 * 1000;

export interface ScoreCandidate {
	userId: string;
	kind: 'post' | 'link';
	itemId: string;
}

/**
 * Inbox items without a prediction from `model` (or whose last try failed and
 * is due a retry), newest first: unread posts from the last week, and shared
 * links once their readable copy is in (or after an hour).
 */
export async function scoreCandidates(
	db: Db,
	limit: number,
	{ model = SCORE_MODEL, now = Date.now() }: { model?: DecisionModel; now?: number } = {}
): Promise<ScoreCandidate[]> {
	const unscored = (kind: 'post' | 'link', userId: unknown, itemId: unknown) => sql`
		not exists (
			select 1 from predictions p
			where p.user_id = ${userId} and p.item_kind = ${kind} and p.item_id = ${itemId}
				and p.model = ${model}
				and (p.error is null or p.attempts >= ${MAX_ATTEMPTS}
					or p.updated_at > ${now} - ${RETRY_AFTER_MS} * p.attempts)
		)`;
	const rows = await db.all<{ user_id: string; kind: 'post' | 'link'; item_id: string }>(sql`
		select user_id, kind, item_id from (
			select s.user_id as user_id, 'post' as kind, fe.id as item_id,
				coalesce(fe.published_at, fe.created_at) as d
			from feed_entries fe
			join subscriptions s on s.feed_id = fe.feed_id
			left join entry_state es on es.entry_id = fe.id and es.user_id = s.user_id
			where es.read_at is null and es.dismissed_at is null
				and fe.created_at >= ${now - POST_WINDOW_MS}
				and ${unscored('post', sql`s.user_id`, sql`fe.id`)}
			union all
			select l.user_id, 'link', l.id, l.queued_at
			from links l
			left join link_archives a on a.link_id = l.id
			where l.status = 'queued'
				and (a.status is null or a.status in ('ready', 'failed')
					or l.saved_at < ${now - COPY_WAIT_MS})
				and ${unscored('link', sql`l.user_id`, sql`l.id`)}
		)
		order by d desc
		limit ${limit}`);
	return rows.map((r) => ({ userId: r.user_id, kind: r.kind, itemId: r.item_id }));
}

/** The item as the model sees it, or null if it's gone. */
async function loadItem(db: Db, c: ScoreCandidate): Promise<ItemForModel | null> {
	if (c.kind === 'post') {
		const [row] = await db
			.select({
				title: feedEntries.title,
				author: feedEntries.author,
				summary: feedEntries.summary,
				content: feedEntries.content,
				source: sql<string>`coalesce(${subscriptions.titleOverride}, ${feeds.title}, ${feeds.url})`
			})
			.from(feedEntries)
			.innerJoin(feeds, eq(feeds.id, feedEntries.feedId))
			.innerJoin(
				subscriptions,
				and(eq(subscriptions.feedId, feeds.id), eq(subscriptions.userId, c.userId))
			)
			.where(eq(feedEntries.id, c.itemId))
			.limit(1);
		if (!row) return null;
		const body = row.content ?? row.summary;
		return {
			kind: 'post',
			title: row.title ?? 'Untitled',
			source: row.source,
			author: row.author,
			text: body ? stripTags(body) : null
		};
	}
	const [row] = await db
		.select({ link: links, text: linkArchives.text })
		.from(links)
		.leftJoin(linkArchives, eq(linkArchives.linkId, links.id))
		.where(and(eq(links.id, c.itemId), eq(links.userId, c.userId)))
		.limit(1);
	if (!row) return null;
	const { link } = row;
	return {
		kind: 'link',
		title: link.title ?? link.url,
		source: link.siteName ?? new URL(link.url).hostname,
		author: link.author,
		note: link.note,
		text: row.text ?? link.description
	};
}

export type ScoreResult =
	| { status: 'scored'; pOpen: number | null; pKeep: number | null; neurons: number }
	| { status: 'capped' | 'gone' }
	| { status: 'failed'; error: string };

/**
 * Scores one item: builds the state from the reader's history and the item,
 * reserves the estimated neurons under today's cap, asks the model, corrects
 * the spend from the reported usage, and records the prediction (or the
 * failure, which is retried later).
 */
export async function scoreItem(
	db: Db,
	ai: AiRunner,
	c: ScoreCandidate,
	{ cap, model = SCORE_MODEL, now = new Date() }: { cap: number; model?: DecisionModel; now?: Date }
): Promise<ScoreResult> {
	const item = await loadItem(db, c);
	if (!item) return { status: 'gone' };
	const state = formatState(await loadProfile(db, c.userId, now.getTime()), item);
	const estimate = estimateCall(model, state, QUESTIONS);
	if (!(await reserveNeurons(db, estimate.neurons, cap, now))) return { status: 'capped' };

	const key = { userId: c.userId, itemKind: c.kind, itemId: c.itemId, model };
	try {
		const { answers, inputTokens, raw } = await decide(ai, model, state, QUESTIONS);
		const neurons = inputTokens === null ? estimate.neurons : estimateNeurons(model, inputTokens);
		await settleNeurons(db, estimate.neurons, neurons, now);
		const pOpen = answers.open?.type === 'noul' ? answers.open.p : null;
		const pKeep = answers.keep?.type === 'noul' ? answers.keep.p : null;
		// The answer format isn't documented field by field yet: keep the raw reply
		// in the logs, so the parser can be checked against what really comes back.
		console.log(
			JSON.stringify({ scored: c, pOpen, pKeep, raw: JSON.stringify(raw).slice(0, 2000) })
		);
		const values = {
			...key,
			pOpen,
			pKeep,
			answers: JSON.stringify(answers),
			inputTokens: inputTokens ?? estimate.tokens,
			neurons,
			error: pOpen === null && pKeep === null ? 'No answers could be read' : null,
			updatedAt: now
		};
		await db
			.insert(predictions)
			.values({ ...values, attempts: 1 })
			.onConflictDoUpdate({
				target: [predictions.userId, predictions.itemKind, predictions.itemId, predictions.model],
				set: { ...values, attempts: sql`${predictions.attempts} + 1` }
			});
		return { status: 'scored', pOpen, pKeep, neurons };
	} catch (err) {
		// A call that failed isn't billed: give the reservation back.
		await settleNeurons(db, estimate.neurons, 0, now);
		const error = err instanceof Error ? err.message : String(err);
		await db
			.insert(predictions)
			.values({ ...key, error, attempts: 1, updatedAt: now })
			.onConflictDoUpdate({
				target: [predictions.userId, predictions.itemKind, predictions.itemId, predictions.model],
				set: { error, attempts: sql`${predictions.attempts} + 1`, updatedAt: now }
			});
		return { status: 'failed', error };
	}
}
