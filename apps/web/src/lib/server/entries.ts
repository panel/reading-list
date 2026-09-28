import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { entryState, feedEntries, feeds, subscriptions, type Db } from '@reading-list/core/db';

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
	readAt: entryState.readAt
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
		);
}

export type InboxEntry = Awaited<ReturnType<typeof getInbox>>['entries'][number];

/** Entries from the user's feeds: unread first, then newest first. */
export async function getInbox(
	db: Db,
	userId: string,
	{ feedId, limit = 60 }: { feedId?: string; limit?: number } = {}
) {
	const notDismissed = isNull(entryState.dismissedAt);
	const where = feedId ? and(notDismissed, eq(feedEntries.feedId, feedId)) : notDismissed;
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
