import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
	findFeed,
	refreshFeed,
	upsertFeed,
	type OpmlFeed,
	type RefreshResult
} from '@reading-list/core';
import {
	entryState,
	feedEntries,
	feeds,
	subscriptions,
	type Db,
	type Feed
} from '@reading-list/core/db';

/** Finds the feed for a URL, stores it (shared) and subscribes the user. */
export async function subscribe(db: Db, userId: string, input: string, fetchFn?: typeof fetch) {
	const found = await findFeed(input, fetchFn);
	const { feed, newEntries } = await upsertFeed(db, found);
	const inserted = await db
		.insert(subscriptions)
		.values({ userId, feedId: feed.id })
		.onConflictDoNothing()
		.returning({ feedId: subscriptions.feedId });
	return { feed, newEntries, alreadySubscribed: inserted.length === 0 };
}

export async function unsubscribe(db: Db, userId: string, feedId: string): Promise<boolean> {
	const deleted = await db
		.delete(subscriptions)
		.where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, feedId)))
		.returning({ feedId: subscriptions.feedId });
	return deleted.length > 0;
}

/** The user's feeds with their unread counts, alphabetically. */
export async function listSubscriptions(db: Db, userId: string) {
	const unread = db
		.select({ feedId: feedEntries.feedId, unread: count().as('unread') })
		.from(feedEntries)
		.leftJoin(
			entryState,
			and(eq(entryState.entryId, feedEntries.id), eq(entryState.userId, userId))
		)
		.where(and(isNull(entryState.readAt), isNull(entryState.dismissedAt)))
		.groupBy(feedEntries.feedId)
		.as('unread_counts');

	return db
		.select({
			feed: feeds,
			titleOverride: subscriptions.titleOverride,
			folder: subscriptions.folder,
			unread: sql<number>`coalesce(${unread.unread}, 0)`
		})
		.from(subscriptions)
		.innerJoin(feeds, eq(feeds.id, subscriptions.feedId))
		.leftJoin(unread, eq(unread.feedId, feeds.id))
		.where(eq(subscriptions.userId, userId))
		.orderBy(
			asc(sql`lower(coalesce(${subscriptions.titleOverride}, ${feeds.title}, ${feeds.url}))`)
		);
}

/** Refreshes every feed the user follows, a few at a time. */
export async function refreshSubscriptions(db: Db, userId: string, fetchFn?: typeof fetch) {
	const rows = await db
		.select({ feed: feeds })
		.from(subscriptions)
		.innerJoin(feeds, eq(feeds.id, subscriptions.feedId))
		.where(eq(subscriptions.userId, userId));
	return refreshMany(
		db,
		rows.map((r) => r.feed),
		fetchFn
	);
}

export async function refreshOne(db: Db, userId: string, feedId: string, fetchFn?: typeof fetch) {
	const [row] = await db
		.select({ feed: feeds })
		.from(subscriptions)
		.innerJoin(feeds, eq(feeds.id, subscriptions.feedId))
		.where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, feedId)));
	return row ? refreshFeed(db, row.feed, fetchFn) : null;
}

async function refreshMany(db: Db, list: Feed[], fetchFn?: typeof fetch, concurrency = 4) {
	const results: { feed: Feed; result: RefreshResult }[] = [];
	for (let i = 0; i < list.length; i += concurrency) {
		const batch = list.slice(i, i + concurrency);
		results.push(
			...(await Promise.all(
				batch.map(async (feed) => ({ feed, result: await refreshFeed(db, feed, fetchFn) }))
			))
		);
	}
	return {
		results,
		newEntries: results.reduce(
			(n, { result }) => n + (result.status === 'updated' ? result.newEntries : 0),
			0
		),
		errors: results.filter(({ result }) => result.status === 'error').length
	};
}

export const feedTitle = (feed: Pick<Feed, 'title' | 'url'>, override?: string | null) =>
	override ?? feed.title ?? new URL(feed.url).hostname.replace(/^www\./, '');

const chunks = <T>(list: T[], size: number) =>
	Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
		list.slice(i * size, (i + 1) * size)
	);

/**
 * Subscribes to every feed in an OPML list. Feeds aren't fetched here (a big
 * list would exceed a request's subrequest and CPU limits); they're created as
 * due now, and the fetcher fills them in over its next few runs.
 */
export async function importFeeds(db: Db, userId: string, list: OpmlFeed[]) {
	const now = new Date();
	// D1 allows 100 bound parameters per statement.
	for (const batch of chunks(list, 15)) {
		await db
			.insert(feeds)
			.values(
				batch.map((f) => ({ url: f.url, title: f.title, siteUrl: f.siteUrl, nextFetchAt: now }))
			)
			.onConflictDoNothing();
	}
	let added = 0;
	for (const batch of chunks(list, 30)) {
		const rows = await db
			.select({ id: feeds.id, url: feeds.url })
			.from(feeds)
			.where(
				inArray(
					feeds.url,
					batch.map((f) => f.url)
				)
			);
		const folderFor = new Map(batch.map((f) => [f.url, f.folder]));
		if (rows.length === 0) continue;
		const inserted = await db
			.insert(subscriptions)
			.values(rows.map((r) => ({ userId, feedId: r.id, folder: folderFor.get(r.url) ?? null })))
			.onConflictDoNothing()
			.returning({ feedId: subscriptions.feedId });
		added += inserted.length;
	}
	return { added, alreadyFollowing: list.length - added };
}

/** The user's subscriptions as OPML entries. */
export async function exportFeeds(db: Db, userId: string): Promise<OpmlFeed[]> {
	const rows = await listSubscriptions(db, userId);
	return rows.map(({ feed, titleOverride, folder }) => ({
		url: feed.url,
		title: feedTitle(feed, titleOverride),
		siteUrl: feed.siteUrl,
		folder: folder ?? null
	}));
}

export async function setFolder(db: Db, userId: string, feedId: string, folder: string | null) {
	const cleaned = folder?.trim().slice(0, 60) || null;
	const updated = await db
		.update(subscriptions)
		.set({ folder: cleaned })
		.where(and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, feedId)))
		.returning({ feedId: subscriptions.feedId });
	return updated.length > 0;
}
