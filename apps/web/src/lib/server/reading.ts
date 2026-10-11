/**
 * The reading digest (Slice 13): what the user read lately and how strongly
 * they reacted, for an agent to talk it over with them.
 */
import { and, desc, eq, gte, isNotNull, ne, or, sql } from 'drizzle-orm';
import {
	categoriesFor,
	listCategories,
	reactionReasons,
	reactionScore,
	type ReadingSignals
} from '@reading-list/core';
import {
	entryState,
	feedEntries,
	feeds,
	links,
	subscriptions,
	type Db
} from '@reading-list/core/db';
import { withTags } from './links';

const DAY = 24 * 60 * 60 * 1000;

export interface ReadingItem {
	kind: 'link' | 'post';
	id: string;
	title: string | null;
	url: string | null;
	/** Site name for a link, feed title for a post. */
	source: string | null;
	author: string | null;
	note: string | null;
	tags: string[];
	category: string | null;
	reasons: string[];
	score: number;
	lastActivity: Date;
}

const latest = (...dates: (Date | null)[]) =>
	new Date(Math.max(...dates.map((d) => d?.getTime() ?? 0)));

type Ranked = Omit<ReadingItem, 'category'>;

/** Strongest reaction first, then most recent. */
export function rankReading<T extends Pick<ReadingItem, 'score' | 'lastActivity'>>(items: T[]) {
	return [...items].sort(
		(a, b) => b.score - a.score || b.lastActivity.getTime() - a.lastActivity.getTime()
	);
}

/**
 * What the user read and reacted to in the last `days`: saved links they
 * finished, starred, opened, shared or wrote a note on, and (with `posts`)
 * feed posts they opened or shared. A post they saved or starred is listed
 * once, as its link.
 */
export async function recentReading(
	db: Db,
	userId: string,
	{ days = 14, limit = 20, posts = true }: { days?: number; limit?: number; posts?: boolean } = {}
): Promise<ReadingItem[]> {
	const since = new Date(Date.now() - days * DAY);
	const linkRows = await db
		.select()
		.from(links)
		.where(
			and(
				eq(links.userId, userId),
				or(
					gte(links.readAt, since),
					gte(links.starredAt, since),
					gte(links.openedAt, since),
					gte(links.citedAt, since),
					and(isNotNull(links.note), ne(links.note, ''), gte(links.updatedAt, since))
				)
			)
		)
		.orderBy(desc(links.updatedAt))
		.limit(200);

	const postRows = posts
		? await db
				.select({
					id: feedEntries.id,
					title: feedEntries.title,
					url: feedEntries.url,
					author: feedEntries.author,
					feedTitle: sql<string>`coalesce(${subscriptions.titleOverride}, ${feeds.title}, ${feeds.url})`,
					openedAt: entryState.openedAt,
					citedAt: entryState.citedAt
				})
				.from(entryState)
				.innerJoin(feedEntries, eq(feedEntries.id, entryState.entryId))
				.innerJoin(feeds, eq(feeds.id, feedEntries.feedId))
				.leftJoin(
					subscriptions,
					and(eq(subscriptions.feedId, feeds.id), eq(subscriptions.userId, userId))
				)
				.where(
					and(
						eq(entryState.userId, userId),
						or(gte(entryState.openedAt, since), gte(entryState.citedAt, since)),
						sql`not exists (select 1 from links l where l.user_id = ${userId}
							and l.source_entry_id = ${feedEntries.id})`
					)
				)
				.orderBy(desc(entryState.openedAt))
				.limit(200)
		: [];

	const withTagList = await withTags(db, linkRows);
	const items: Ranked[] = [
		...withTagList.map((l) => {
			const signals: ReadingSignals = {
				note: Boolean(l.note?.trim()),
				starred: l.isReference,
				cites: l.citeCount,
				opened: Boolean(l.openedAt),
				done: l.status === 'archived'
			};
			return {
				kind: 'link' as const,
				id: l.id,
				title: l.title,
				url: l.url,
				source: l.siteName,
				author: l.author,
				note: l.note,
				tags: l.tags,
				reasons: reactionReasons(signals),
				score: reactionScore(signals),
				lastActivity: latest(l.readAt, l.starredAt, l.openedAt, l.citedAt, l.updatedAt)
			};
		}),
		...postRows.map((p) => {
			const signals: ReadingSignals = {
				note: false,
				starred: false,
				cites: p.citedAt ? 1 : 0,
				opened: Boolean(p.openedAt),
				done: false
			};
			return {
				kind: 'post' as const,
				id: p.id,
				title: p.title,
				url: p.url,
				source: p.feedTitle,
				author: p.author,
				note: null,
				tags: [],
				reasons: reactionReasons(signals),
				score: reactionScore(signals),
				lastActivity: latest(p.openedAt, p.citedAt)
			};
		})
	];
	const top = rankReading(items).slice(0, limit);

	const [placed, defs] = await Promise.all([
		categoriesFor(db, userId, top),
		listCategories(db, userId)
	]);
	const names = new Map(defs.map((c) => [c.slug, c.name]));
	return top.map((item) => {
		const slug = placed.get(`${item.kind}:${item.id}`)?.slugs[0];
		return {
			...item,
			category: slug ? (names.get(slug) ?? (slug === 'other' ? 'Other' : slug)) : null
		};
	});
}
