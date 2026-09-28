import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { canonicalizeUrl, parseHttpUrl, parseTags, ulid } from '@reading-list/core';
import { links, linkTags, tags, type Db, type Link } from '@reading-list/core/db';
import { fetchPageMetadata } from './metadata';

export type LinkWithTags = Link & { tags: string[] };

export interface SaveLinkInput {
	url: string;
	note?: string | null;
	tags?: string | string[] | null;
}

const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, '');

/**
 * Picks the URL used for deduplication. A page's own canonical URL is trusted
 * only when it's on the same site and isn't just the homepage (some sites
 * point every page's canonical at "/").
 */
export function chooseCanonical(finalUrl: string, pageCanonical: string | null): string {
	const fromFinal = canonicalizeUrl(finalUrl);
	if (!pageCanonical) return fromFinal;
	try {
		const candidate = new URL(pageCanonical);
		const final = new URL(finalUrl);
		if (hostOf(candidate.href) !== hostOf(final.href)) return fromFinal;
		if (candidate.pathname === '/' && final.pathname !== '/') return fromFinal;
		return canonicalizeUrl(candidate);
	} catch {
		return fromFinal;
	}
}

/** Combines an existing note with a newly entered one without losing either. */
export function mergeNote(existing: string | null, incoming: string | null | undefined) {
	const next = incoming?.trim();
	if (!next) return existing;
	if (!existing?.trim() || existing.includes(next)) return existing?.trim() ? existing : next;
	return `${existing.trim()}\n\n${next}`;
}

/**
 * Saves a link for a user: resolves redirects, fetches preview metadata,
 * dedupes on the canonical URL and merges tags. Saving a link that's already
 * there updates it, merges the note, and puts it back in the queue.
 */
export async function saveLink(
	db: Db,
	userId: string,
	input: SaveLinkInput,
	fetchFn?: typeof fetch
): Promise<{ link: Link; existed: boolean }> {
	const requested = parseHttpUrl(input.url).toString();
	const { finalUrl, metadata } = await fetchPageMetadata(requested, fetchFn);
	const canonicalUrl = chooseCanonical(finalUrl, metadata?.canonicalUrl ?? null);
	const tagNames = parseTags(input.tags);
	const now = new Date();

	const existing = await db.query.links.findFirst({
		where: and(eq(links.userId, userId), eq(links.canonicalUrl, canonicalUrl))
	});

	const fields = {
		url: finalUrl,
		title: metadata?.title ?? existing?.title ?? null,
		description: metadata?.description ?? existing?.description ?? null,
		siteName: metadata?.siteName ?? existing?.siteName ?? null,
		author: metadata?.author ?? existing?.author ?? null,
		imageUrl: metadata?.imageUrl ?? existing?.imageUrl ?? null,
		faviconUrl: metadata?.faviconUrl ?? existing?.faviconUrl ?? null,
		note: mergeNote(existing?.note ?? null, input.note),
		status: 'queued' as const,
		queuedAt: now,
		updatedAt: now
	};

	const linkId = existing?.id ?? ulid();
	const writeLink = existing
		? db.update(links).set(fields).where(eq(links.id, linkId))
		: db
				.insert(links)
				.values({ id: linkId, userId, canonicalUrl, source: 'manual', savedAt: now, ...fields });

	if (tagNames.length === 0) {
		await writeLink;
	} else {
		await db.batch([
			writeLink,
			db
				.insert(tags)
				.values(tagNames.map((name) => ({ id: ulid(), userId, name })))
				.onConflictDoNothing(),
			db
				.insert(linkTags)
				.select(
					db
						.select({ linkId: sql<string>`${linkId}`.as('link_id'), tagId: tags.id })
						.from(tags)
						.where(and(eq(tags.userId, userId), inArray(tags.name, tagNames)))
				)
				.onConflictDoNothing()
		]);
	}

	const link = await db.query.links.findFirst({ where: eq(links.id, linkId) });
	if (!link) throw new Error(`Link ${linkId} vanished after saving`);
	return { link, existed: Boolean(existing) };
}

async function withTags(db: Db, rows: Link[]): Promise<LinkWithTags[]> {
	if (rows.length === 0) return [];
	const tagRows = await db
		.select({ linkId: linkTags.linkId, name: tags.name })
		.from(linkTags)
		.innerJoin(tags, eq(tags.id, linkTags.tagId))
		.where(
			inArray(
				linkTags.linkId,
				rows.map((r) => r.id)
			)
		)
		.orderBy(asc(tags.name));
	const byLink = new Map<string, string[]>();
	for (const { linkId, name } of tagRows) {
		byLink.set(linkId, [...(byLink.get(linkId) ?? []), name]);
	}
	return rows.map((r) => ({ ...r, tags: byLink.get(r.id) ?? [] }));
}

/** The queue, oldest first: "Later" bumps an item's queued_at, sending it to the back. */
export async function getQueue(db: Db, userId: string, limit = 20) {
	const where = and(eq(links.userId, userId), eq(links.status, 'queued'));
	const [rows, [{ total }]] = await Promise.all([
		db.select().from(links).where(where).orderBy(asc(links.queuedAt), asc(links.id)).limit(limit),
		db.select({ total: count() }).from(links).where(where)
	]);
	return { items: await withTags(db, rows), total };
}

export async function getLink(db: Db, userId: string, id: string) {
	const row = await db.query.links.findFirst({
		where: and(eq(links.id, id), eq(links.userId, userId))
	});
	return row ? (await withTags(db, [row]))[0] : null;
}
