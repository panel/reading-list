import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { canonicalizeUrl, ulid } from '@reading-list/core';
import {
	entryState,
	feedEntries,
	feeds,
	links,
	subscriptions,
	type Db,
	type Link
} from '@reading-list/core/db';

// Entries without a publish date sort by when we first saw them.
const entryDate = sql<number>`coalesce(${feedEntries.publishedAt}, ${feedEntries.createdAt})`;

const listFields = {
	id: feedEntries.id,
	feedId: feedEntries.feedId,
	url: feedEntries.url,
	title: feedEntries.title,
	author: feedEntries.author,
	summary: feedEntries.summary,
	imageUrl: feedEntries.imageUrl,
	publishedAt: feedEntries.publishedAt,
	createdAt: feedEntries.createdAt,
	feedTitle: sql<string>`coalesce(${subscriptions.titleOverride}, ${feeds.title}, ${feeds.url})`,
	readAt: entryState.readAt,
	// Set when the post was saved or starred from the feed.
	linkId: links.id,
	linkStatus: links.status,
	linkIsReference: links.isReference
};

function subscribedEntries(db: Db, userId: string) {
	return db
		.select(listFields)
		.from(feedEntries)
		.innerJoin(
			subscriptions,
			and(eq(subscriptions.feedId, feedEntries.feedId), eq(subscriptions.userId, userId))
		)
		.innerJoin(feeds, eq(feeds.id, feedEntries.feedId))
		.leftJoin(
			entryState,
			and(eq(entryState.entryId, feedEntries.id), eq(entryState.userId, userId))
		)
		.leftJoin(links, and(eq(links.sourceEntryId, feedEntries.id), eq(links.userId, userId)));
}

export type InboxEntry = Awaited<ReturnType<typeof getInbox>>['entries'][number];

/** Entries from the user's feeds: unread first, then newest first. */
export async function getInbox(
	db: Db,
	userId: string,
	{ feedId, folder, limit = 60 }: { feedId?: string; folder?: string; limit?: number } = {}
) {
	const where = and(
		isNull(entryState.dismissedAt),
		feedId ? eq(feedEntries.feedId, feedId) : undefined,
		folder ? eq(subscriptions.folder, folder) : undefined
	);
	const entries = await subscribedEntries(db, userId)
		.where(where)
		.orderBy(sql`${entryState.readAt} is not null`, desc(entryDate), desc(feedEntries.id))
		.limit(limit);
	const unread = entries.filter((e) => !e.readAt).length;
	return { entries, unread };
}

/** One entry with its full content, if it's in a feed the user follows. */
export async function getEntry(db: Db, userId: string, id: string) {
	const [row] = await db
		.select({
			...listFields,
			content: feedEntries.content,
			siteUrl: feeds.siteUrl,
			feedUrl: feeds.url
		})
		.from(feedEntries)
		.innerJoin(
			subscriptions,
			and(eq(subscriptions.feedId, feedEntries.feedId), eq(subscriptions.userId, userId))
		)
		.innerJoin(feeds, eq(feeds.id, feedEntries.feedId))
		.leftJoin(
			entryState,
			and(eq(entryState.entryId, feedEntries.id), eq(entryState.userId, userId))
		)
		.leftJoin(links, and(eq(links.sourceEntryId, feedEntries.id), eq(links.userId, userId)))
		.where(eq(feedEntries.id, id))
		.limit(1);
	return row ?? null;
}

export async function markRead(db: Db, userId: string, entryId: string, read = true) {
	await db
		.insert(entryState)
		.values({ userId, entryId, readAt: read ? new Date() : null })
		.onConflictDoUpdate({
			target: [entryState.userId, entryState.entryId],
			set: { readAt: read ? sql`coalesce(${entryState.readAt}, excluded.read_at)` : null }
		});
}

/** The newest unread entry other than this one, for "Up next". */
export async function nextUnread(db: Db, userId: string, excludeId: string) {
	const [next] = await subscribedEntries(db, userId)
		.where(
			and(
				isNull(entryState.readAt),
				isNull(entryState.dismissedAt),
				sql`${feedEntries.id} <> ${excludeId}`
			)
		)
		.orderBy(desc(entryDate), desc(feedEntries.id))
		.limit(1);
	return next ?? null;
}

const UNREAD_WINDOW_DAYS = 60;

/**
 * Unread posts across the user's feeds, for the navigation badge. Limited to
 * the last 60 days so it stays a cheap query on every page load.
 */
export async function unreadCount(db: Db, userId: string): Promise<number> {
	const since = Date.now() - UNREAD_WINDOW_DAYS * 24 * 60 * 60 * 1000;
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(feedEntries)
		.innerJoin(
			subscriptions,
			and(eq(subscriptions.feedId, feedEntries.feedId), eq(subscriptions.userId, userId))
		)
		.leftJoin(
			entryState,
			and(eq(entryState.entryId, feedEntries.id), eq(entryState.userId, userId))
		)
		.where(
			and(isNull(entryState.readAt), isNull(entryState.dismissedAt), sql`${entryDate} >= ${since}`)
		);
	return Number(row?.n ?? 0);
}

type EntryForLink = NonNullable<Awaited<ReturnType<typeof getEntry>>>;

/**
 * The user's link for a feed post: one saved from this post, or one saved
 * some other way (e.g. the Shortcut) with the same canonical URL.
 */
export async function linkForEntry(
	db: Db,
	userId: string,
	entry: Pick<EntryForLink, 'id' | 'url'>
) {
	let canonical: string | null = null;
	try {
		canonical = entry.url ? canonicalizeUrl(entry.url) : null;
	} catch {
		// unusable URL: match on the entry id only
	}
	return (
		(await db.query.links.findFirst({
			where: and(
				eq(links.userId, userId),
				canonical
					? or(eq(links.sourceEntryId, entry.id), eq(links.canonicalUrl, canonical))
					: eq(links.sourceEntryId, entry.id)
			)
		})) ?? null
	);
}

export class EntryHasNoUrlError extends Error {}

/**
 * Keeps a feed post as a link. "queue" puts it at the back of the queue
 * (like saving it by hand); "star" makes it a reference without queueing it,
 * since a starred post has usually just been read. Either marks the post read.
 */
export async function keepEntry(
	db: Db,
	userId: string,
	entry: EntryForLink,
	mode: 'queue' | 'star'
): Promise<{ link: Link; created: boolean }> {
	if (!entry.url) throw new EntryHasNoUrlError('This post has no link to save');
	const now = new Date();
	const existing = await linkForEntry(db, userId, entry);

	if (existing) {
		await db
			.update(links)
			.set(
				mode === 'queue'
					? { status: 'queued', queuedAt: now, readAt: null, updatedAt: now }
					: { isReference: true, starredAt: existing.starredAt ?? now, updatedAt: now }
			)
			.where(eq(links.id, existing.id));
	} else {
		await db.insert(links).values({
			id: ulid(),
			userId,
			url: entry.url,
			canonicalUrl: canonicalizeUrl(entry.url),
			title: entry.title,
			description: entry.summary,
			siteName: entry.feedTitle,
			author: entry.author,
			imageUrl: entry.imageUrl,
			faviconUrl: new URL('/favicon.ico', entry.url).toString(),
			source: 'feed',
			sourceEntryId: entry.id,
			savedAt: now,
			queuedAt: now,
			updatedAt: now,
			...(mode === 'queue'
				? { status: 'queued' as const }
				: { status: 'archived' as const, readAt: now, isReference: true, starredAt: now })
		});
	}
	await markRead(db, userId, entry.id);
	const link = await linkForEntry(db, userId, entry);
	return { link: link!, created: !existing };
}

/** Hides a post from the inbox (or brings it back). */
export async function setDismissed(db: Db, userId: string, entryId: string, dismissed: boolean) {
	const at = dismissed ? new Date() : null;
	await db
		.insert(entryState)
		.values({ userId, entryId, dismissedAt: at, readAt: at })
		.onConflictDoUpdate({
			target: [entryState.userId, entryState.entryId],
			set: dismissed
				? { dismissedAt: at, readAt: sql`coalesce(${entryState.readAt}, excluded.read_at)` }
				: { dismissedAt: null }
		});
}

/** Marks every post in the user's feeds (or one feed) read. Returns how many changed. */
export async function markAllRead(
	db: Db,
	userId: string,
	{ feedId, folder }: { feedId?: string; folder?: string } = {}
): Promise<number> {
	const now = Date.now();
	// (An INSERT … SELECT upsert needs a WHERE clause, or SQLite reads ON CONFLICT as part of a join.)
	const result = await db.run(sql`
		insert into entry_state (user_id, entry_id, read_at)
		select ${userId}, fe.id, ${now}
		from feed_entries fe
		join subscriptions s on s.feed_id = fe.feed_id and s.user_id = ${userId}
		left join entry_state es on es.entry_id = fe.id and es.user_id = ${userId}
		where es.read_at is null ${feedId ? sql`and fe.feed_id = ${feedId}` : sql``}
		${folder ? sql`and s.folder = ${folder}` : sql``}
		on conflict (user_id, entry_id) do update set read_at = excluded.read_at
	`);
	return result.meta.changes ?? 0;
}
