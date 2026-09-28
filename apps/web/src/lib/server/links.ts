import { and, asc, count, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
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
	if (!existing?.trim()) return next;
	// Ignore whitespace differences (a pasted note vs. one with line breaks).
	const squash = (text: string) => text.replace(/\s+/g, ' ').toLowerCase();
	if (squash(existing).includes(squash(next))) return existing;
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

export async function withTags(db: Db, rows: Link[]): Promise<LinkWithTags[]> {
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

import type { QueueState } from '$lib/queue';

export type { QueueState };

const stateOf = (link: Link): QueueState => ({
	status: link.status,
	queuedAt: link.queuedAt.getTime(),
	readAt: link.readAt?.getTime() ?? null
});

/** Parses an undo state posted back by the client; null if it isn't one. */
export function parseQueueState(input: {
	status: unknown;
	queuedAt: unknown;
	readAt: unknown;
}): QueueState | null {
	const status = input.status;
	const queuedAt = Number(input.queuedAt);
	const readAt = input.readAt === '' || input.readAt == null ? null : Number(input.readAt);
	if (status !== 'queued' && status !== 'archived') return null;
	if (!Number.isSafeInteger(queuedAt) || queuedAt < 0) return null;
	if (readAt !== null && (!Number.isSafeInteger(readAt) || readAt < 0)) return null;
	return { status, queuedAt, readAt };
}

const ownLink = (userId: string, id: string) => and(eq(links.id, id), eq(links.userId, userId));

/**
 * Applies a change to one of the user's links and returns its state before
 * the change (for undo), or null if there's no such link.
 */
async function changeLink(
	db: Db,
	userId: string,
	id: string,
	set: Partial<typeof links.$inferInsert>
): Promise<QueueState | null> {
	const before = await db.query.links.findFirst({ where: ownLink(userId, id) });
	if (!before) return null;
	await db
		.update(links)
		.set({ ...set, updatedAt: new Date() })
		.where(ownLink(userId, id));
	return stateOf(before);
}

/** Finished: done with it. Leaves the queue for the archive. */
export const finishLink = (db: Db, userId: string, id: string) =>
	changeLink(db, userId, id, { status: 'archived', readAt: new Date() });

/** Later: keep it, but move it to the back of the queue. */
export const laterLink = (db: Db, userId: string, id: string) =>
	changeLink(db, userId, id, { status: 'queued', queuedAt: new Date() });

/** Back to the queue from the archive (at the back), or to an exact earlier state (undo). */
export const requeueLink = (db: Db, userId: string, id: string, state?: QueueState) =>
	changeLink(
		db,
		userId,
		id,
		state
			? {
					status: state.status,
					queuedAt: new Date(state.queuedAt),
					readAt: state.readAt === null ? null : new Date(state.readAt)
				}
			: { status: 'queued', queuedAt: new Date(), readAt: null }
	);

export const starLink = (db: Db, userId: string, id: string, starred: boolean) =>
	changeLink(db, userId, id, { isReference: starred, starredAt: starred ? new Date() : null });

export const setNote = (db: Db, userId: string, id: string, note: string) =>
	changeLink(db, userId, id, { note: note.trim() || null });

export async function appendNote(db: Db, userId: string, id: string, note: string) {
	const link = await db.query.links.findFirst({ where: ownLink(userId, id) });
	if (!link) return null;
	return changeLink(db, userId, id, { note: mergeNote(link.note, note) });
}

/** Replaces a link's tags. Tags no longer used by any link are left in place for reuse. */
export async function setTags(db: Db, userId: string, id: string, input: string) {
	const link = await db.query.links.findFirst({ where: ownLink(userId, id) });
	if (!link) return false;
	const names = parseTags(input);
	const clear = db.delete(linkTags).where(eq(linkTags.linkId, id));
	if (names.length === 0) {
		await clear;
		return true;
	}
	await db.batch([
		clear,
		db
			.insert(tags)
			.values(names.map((name) => ({ id: ulid(), userId, name })))
			.onConflictDoNothing(),
		db
			.insert(linkTags)
			.select(
				db
					.select({ linkId: sql<string>`${id}`.as('link_id'), tagId: tags.id })
					.from(tags)
					.where(and(eq(tags.userId, userId), inArray(tags.name, names)))
			)
			.onConflictDoNothing()
	]);
	return true;
}

export async function deleteLink(db: Db, userId: string, id: string): Promise<boolean> {
	const deleted = await db.delete(links).where(ownLink(userId, id)).returning({ id: links.id });
	return deleted.length > 0;
}

/**
 * The queue items around a link, for "next" after Finished/Later and for J/K.
 * For a link that isn't queued, next is simply the front of the queue.
 */
export async function queueNeighbors(db: Db, userId: string, link: Link) {
	const queued = and(eq(links.userId, userId), eq(links.status, 'queued'));
	const pick = { id: links.id };
	if (link.status !== 'queued') {
		const [next] = await db
			.select(pick)
			.from(links)
			.where(queued)
			.orderBy(asc(links.queuedAt), asc(links.id))
			.limit(1);
		return { prevId: null, nextId: next?.id ?? null };
	}
	const after = or(
		gt(links.queuedAt, link.queuedAt),
		and(eq(links.queuedAt, link.queuedAt), gt(links.id, link.id))
	);
	const before = or(
		lt(links.queuedAt, link.queuedAt),
		and(eq(links.queuedAt, link.queuedAt), lt(links.id, link.id))
	);
	const [[next], [prev]] = await Promise.all([
		db
			.select(pick)
			.from(links)
			.where(and(queued, after))
			.orderBy(asc(links.queuedAt), asc(links.id))
			.limit(1),
		db
			.select(pick)
			.from(links)
			.where(and(queued, before))
			.orderBy(desc(links.queuedAt), desc(links.id))
			.limit(1)
	]);
	return { prevId: prev?.id ?? null, nextId: next?.id ?? null };
}

/** Finished links, most recently finished first. */
export async function getArchive(db: Db, userId: string, limit = 50, offset = 0) {
	const where = and(eq(links.userId, userId), eq(links.status, 'archived'));
	const [rows, [{ total }]] = await Promise.all([
		db
			.select()
			.from(links)
			.where(where)
			.orderBy(desc(links.readAt), desc(links.id))
			.limit(limit)
			.offset(offset),
		db.select({ total: count() }).from(links).where(where)
	]);
	return { items: await withTags(db, rows), total };
}
