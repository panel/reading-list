import { and, count, desc, eq, ne } from 'drizzle-orm';
import { links, type Db, type Link } from '@reading-list/core/db';
import { displayTitle, siteLabel } from '$lib/format';
import { categoriesFor, KEEP_CANDIDATE, likelyScore, predictionsFor } from '@reading-list/core';
import {
	getInbox as getPosts,
	inCategory,
	nextUnread,
	unreadCount,
	type InboxEntry
} from './entries';

/**
 * The inbox: posts from the user's feeds plus the links they've shared in
 * (the "Shared" feed). A shared link is a queued link: sending one in adds it,
 * and Done archives it.
 */
export type InboxItem = {
	kind: 'post' | 'shared';
	id: string;
	url: string | null;
	title: string;
	/** The feed's name, or the site's for a shared link. */
	source: string;
	/** A shared link's own note, else its description; a post's summary. */
	summary: string | null;
	note: boolean;
	imageUrl: string | null;
	/** When it was published, or when the link was (last) shared. */
	date: Date;
	read: boolean;
	starred: boolean;
	/** Category slugs: the first is the main one. Empty until it's been sorted. */
	categories: string[];
	/** Predicted chances of opening it and of starring it (Slice 12), once scored. */
	pOpen: number | null;
	pKeep: number | null;
	/** Likely to be starred: shown as a Library candidate. */
	candidate: boolean;
};

/**
 * `feed: 'shared'` shows only shared links; a feed id or a folder shows only
 * posts; a category shows posts and shared links in it.
 */
export type InboxFilter = { feedId?: string; folder?: string; category?: string };

/** Newest first, or "Likely reads": by the chance of opening, favouring newer items. */
export type InboxSort = 'newest' | 'likely';

export const SHARED = 'shared';

const sharedWhere = (userId: string) => and(eq(links.userId, userId), eq(links.status, 'queued'));

function postItem(entry: InboxEntry): InboxItem {
	return {
		kind: 'post',
		id: entry.id,
		url: entry.url,
		title: entry.title ?? entry.summary?.slice(0, 80) ?? 'Untitled',
		source: entry.feedTitle,
		summary: entry.summary,
		note: false,
		imageUrl: entry.imageUrl,
		date: entry.publishedAt ?? entry.createdAt,
		read: Boolean(entry.readAt),
		starred: Boolean(entry.linkIsReference),
		categories: [],
		pOpen: null,
		pKeep: null,
		candidate: false
	};
}

function sharedItem(link: Link): InboxItem {
	return {
		kind: 'shared',
		id: link.id,
		url: link.url,
		title: displayTitle(link),
		source: siteLabel(link),
		summary: link.note ?? link.description,
		note: Boolean(link.note),
		imageUrl: link.imageUrl,
		date: link.queuedAt,
		read: false,
		starred: link.isReference,
		categories: [],
		pOpen: null,
		pKeep: null,
		candidate: false
	};
}

const newestFirst = (a: InboxItem, b: InboxItem) =>
	b.date.getTime() - a.date.getTime() || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0);

/** Unread first, then newest first; shared links are always unread. */
export async function getInbox(
	db: Db,
	userId: string,
	{ feedId, folder, category }: InboxFilter = {},
	limit = 60,
	sort: InboxSort = 'newest'
) {
	const wantShared = !folder && (!feedId || feedId === SHARED);
	const wantPosts = feedId !== SHARED;
	const [posts, shared, [{ sharedTotal }]] = await Promise.all([
		wantPosts ? getPosts(db, userId, { feedId, folder, category, limit }) : null,
		wantShared
			? db
					.select()
					.from(links)
					.where(
						and(
							sharedWhere(userId),
							category ? inCategory(userId, 'link', links.id, category) : undefined
						)
					)
					.orderBy(desc(links.queuedAt), desc(links.id))
					.limit(limit)
			: [],
		db.select({ sharedTotal: count() }).from(links).where(sharedWhere(userId))
	]);

	const postItems = (posts?.entries ?? []).map(postItem);
	const items = [
		...[...postItems.filter((p) => !p.read), ...shared.map(sharedItem)].sort(newestFirst),
		...postItems.filter((p) => p.read)
	].slice(0, limit);
	const refs = items.map((i) => ({
		kind: i.kind === 'post' ? ('post' as const) : ('link' as const),
		id: i.id
	}));
	const [placed, scores] = await Promise.all([
		categoriesFor(db, userId, refs),
		predictionsFor(db, userId, refs)
	]);
	items.forEach((item, i) => {
		const key = `${refs[i].kind}:${item.id}`;
		item.categories = placed.get(key)?.slugs ?? [];
		item.pOpen = scores.get(key)?.pOpen ?? null;
		item.pKeep = scores.get(key)?.pKeep ?? null;
		item.candidate = !item.starred && (item.pKeep ?? 0) >= KEEP_CANDIDATE;
	});
	if (sort === 'likely') {
		// Unread first as always; within them, the likeliest reads (newer ones favoured).
		const now = Date.now();
		const rank = (i: InboxItem) => (i.read ? -1 : likelyScore(i.pOpen, i.date, now));
		items.sort((a, b) => rank(b) - rank(a));
	}
	return {
		items,
		unread: (posts?.unread ?? 0) + (wantShared ? shared.length : 0),
		shared: sharedTotal
	};
}

/**
 * The top of the inbox other than this item: the newest unread post or shared
 * link. Finishing a link or reading a post moves on to it.
 */
export async function nextInboxItem(db: Db, userId: string, excludeId: string) {
	const [post, [link]] = await Promise.all([
		nextUnread(db, userId, excludeId),
		db
			.select()
			.from(links)
			.where(and(sharedWhere(userId), ne(links.id, excludeId)))
			.orderBy(desc(links.queuedAt), desc(links.id))
			.limit(1)
	]);
	const candidates = [post && postItem(post), link && sharedItem(link)].filter(
		(i): i is InboxItem => Boolean(i)
	);
	return candidates.sort(newestFirst)[0] ?? null;
}

/** Unread posts plus shared links, for the navigation badge. */
export async function inboxCount(db: Db, userId: string): Promise<number> {
	const [posts, [{ n }]] = await Promise.all([
		unreadCount(db, userId),
		db.select({ n: count() }).from(links).where(sharedWhere(userId))
	]);
	return posts + n;
}
