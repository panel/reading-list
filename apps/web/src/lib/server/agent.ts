/**
 * Operations for API tokens: the JSON API (/api/*) and the MCP server
 * (/api/mcp) both call these, so scopes, output shapes and the activity log
 * are the same whichever way an agent connects.
 */
import { and, desc, eq } from 'drizzle-orm';
import { decodeEntities, FeedNotFoundError, InvalidUrlError } from '@reading-list/core';
import {
	activity,
	entryState,
	links,
	type Activity,
	type ApiToken,
	type Db,
	type User
} from '@reading-list/core/db';
import type { Scope } from '$lib/tokens';
import {
	EntryHasNoUrlError,
	getEntry,
	getInbox,
	keepEntry,
	linkForEntry,
	markRead,
	setDismissed
} from './entries';
import { feedTitle, listSubscriptions, subscribe, unsubscribe } from './feeds';
import {
	appendNote,
	deleteLink,
	finishLink,
	getLink,
	getQueue,
	requeueLink,
	saveLink,
	setNote,
	setTags,
	starLink,
	type LinkWithTags
} from './links';
import { MATCH_END, MATCH_START, searchLinks } from './search';
import { hasScope } from './tokens';

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export interface AgentContext {
	db: Db;
	user: User;
	token: ApiToken;
	/** The app's origin, for links back into the UI. */
	origin: string;
}

function need(ctx: AgentContext, scope: Scope) {
	if (!hasScope(ctx.token, scope)) {
		throw new ApiError(403, `This token doesn’t have the ${scope} scope`);
	}
}

const clampLimit = (value: unknown, fallback: number, max = 100) => {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
};

// ——— Output shapes ————————————————————————————————————————————————

export function linkJson(link: LinkWithTags, origin: string) {
	return {
		id: link.id,
		url: link.url,
		title: link.title,
		site: link.siteName,
		author: link.author,
		description: link.description,
		note: link.note,
		tags: link.tags,
		status: link.status,
		reference: link.isReference,
		savedAt: link.savedAt.toISOString(),
		readAt: link.readAt?.toISOString() ?? null,
		appUrl: new URL(`/links/${link.id}`, origin).toString()
	};
}

type EntryRow = Awaited<ReturnType<typeof getInbox>>['entries'][number];

function entryJson(entry: EntryRow, origin: string) {
	return {
		id: entry.id,
		feed: entry.feedTitle,
		title: entry.title,
		url: entry.url,
		author: entry.author,
		summary: entry.summary,
		publishedAt: (entry.publishedAt ?? entry.createdAt).toISOString(),
		read: Boolean(entry.readAt),
		inQueue: entry.linkStatus === 'queued',
		starred: Boolean(entry.linkIsReference),
		appUrl: new URL(`/entries/${entry.id}`, origin).toString()
	};
}

/** A post's HTML as readable plain text, paragraphs kept. */
export function htmlToText(html: string): string {
	return decodeEntities(
		html
			.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr|figure)>/gi, '\n\n')
			.replace(/<li\b[^>]*>/gi, '• ')
			.replace(/<[^>]*>/g, '')
	)
		.replace(/[ \t]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

// ——— Activity log and undo ———————————————————————————————————————————

type LinkSnapshot = {
	note: string | null;
	status: 'queued' | 'archived';
	queuedAt: number;
	readAt: number | null;
	isReference: boolean;
	starredAt: number | null;
	tags: string[];
};

export type Undo =
	| { type: 'deleteLink'; id: string }
	| { type: 'restoreLink'; id: string; snapshot: LinkSnapshot }
	| { type: 'entryState'; entryId: string; readAt: number | null; dismissedAt: number | null }
	| { type: 'unsubscribe'; feedId: string }
	| { type: 'all'; steps: Undo[] };

async function snapshotLink(db: Db, userId: string, id: string): Promise<LinkSnapshot | null> {
	const link = await getLink(db, userId, id);
	if (!link) return null;
	return {
		note: link.note,
		status: link.status,
		queuedAt: link.queuedAt.getTime(),
		readAt: link.readAt?.getTime() ?? null,
		isReference: link.isReference,
		starredAt: link.starredAt?.getTime() ?? null,
		tags: link.tags
	};
}

async function snapshotEntry(db: Db, userId: string, entryId: string) {
	const row = await db.query.entryState.findFirst({
		where: and(eq(entryState.userId, userId), eq(entryState.entryId, entryId))
	});
	return {
		readAt: row?.readAt?.getTime() ?? null,
		dismissedAt: row?.dismissedAt?.getTime() ?? null
	};
}

async function record(
	ctx: AgentContext,
	action: string,
	targetId: string | null,
	summary: string,
	undo: Undo | null
) {
	await ctx.db.insert(activity).values({
		userId: ctx.user.id,
		tokenId: ctx.token.id,
		actor: ctx.token.name,
		action,
		targetId,
		summary: summary.slice(0, 300),
		undo: undo ? JSON.stringify(undo) : null
	});
}

async function applyUndo(db: Db, userId: string, undo: Undo): Promise<void> {
	switch (undo.type) {
		case 'all':
			for (const step of undo.steps) await applyUndo(db, userId, step);
			return;
		case 'deleteLink':
			await deleteLink(db, userId, undo.id);
			return;
		case 'unsubscribe':
			await unsubscribe(db, userId, undo.feedId);
			return;
		case 'restoreLink': {
			const s = undo.snapshot;
			await db
				.update(links)
				.set({
					note: s.note,
					status: s.status,
					queuedAt: new Date(s.queuedAt),
					readAt: s.readAt === null ? null : new Date(s.readAt),
					isReference: s.isReference,
					starredAt: s.starredAt === null ? null : new Date(s.starredAt),
					updatedAt: new Date()
				})
				.where(and(eq(links.id, undo.id), eq(links.userId, userId)));
			await setTags(db, userId, undo.id, s.tags.join(','));
			return;
		}
		case 'entryState':
			await db
				.insert(entryState)
				.values({
					userId,
					entryId: undo.entryId,
					readAt: undo.readAt === null ? null : new Date(undo.readAt),
					dismissedAt: undo.dismissedAt === null ? null : new Date(undo.dismissedAt)
				})
				.onConflictDoUpdate({
					target: [entryState.userId, entryState.entryId],
					set: {
						readAt: undo.readAt === null ? null : new Date(undo.readAt),
						dismissedAt: undo.dismissedAt === null ? null : new Date(undo.dismissedAt)
					}
				});
			return;
	}
}

export function listActivity(db: Db, userId: string, limit = 50) {
	return db
		.select()
		.from(activity)
		.where(eq(activity.userId, userId))
		.orderBy(desc(activity.createdAt), desc(activity.id))
		.limit(limit);
}

/** Reverses one logged change (from Settings, by the signed-in user). */
export async function undoActivity(db: Db, userId: string, id: string): Promise<Activity> {
	const row = await db.query.activity.findFirst({
		where: and(eq(activity.id, id), eq(activity.userId, userId))
	});
	if (!row) throw new ApiError(404, 'That change isn’t in your activity log');
	if (row.undoneAt) throw new ApiError(409, 'Already undone');
	if (!row.undo) throw new ApiError(400, 'This change can’t be undone');
	await applyUndo(db, userId, JSON.parse(row.undo) as Undo);
	await db.update(activity).set({ undoneAt: new Date() }).where(eq(activity.id, id));
	return row;
}

// ——— Links ———————————————————————————————————————————————————————————

export async function searchLinksOp(
	ctx: AgentContext,
	input: { query?: unknown; limit?: unknown }
) {
	need(ctx, 'links:read');
	const query = typeof input.query === 'string' ? input.query.trim() : '';
	const limit = clampLimit(input.limit, 20);
	if (!query) {
		const { items, total } = await getQueue(ctx.db, ctx.user.id, limit);
		return { query, total, links: items.map((l) => linkJson(l, ctx.origin)) };
	}
	const { results } = await searchLinks(ctx.db, ctx.user.id, query, { limit });
	return {
		query,
		links: results.map((r) => ({
			...linkJson(r, ctx.origin),
			match: r.snippet?.replaceAll(MATCH_START, '').replaceAll(MATCH_END, '') ?? null
		}))
	};
}

export async function listQueueOp(ctx: AgentContext, input: { limit?: unknown }) {
	need(ctx, 'links:read');
	const { items, total } = await getQueue(ctx.db, ctx.user.id, clampLimit(input.limit, 20));
	return { total, links: items.map((l) => linkJson(l, ctx.origin)) };
}

export async function getLinkOp(ctx: AgentContext, id: string) {
	need(ctx, 'links:read');
	const link = await getLink(ctx.db, ctx.user.id, id);
	if (!link) throw new ApiError(404, 'Link not found');
	return { link: linkJson(link, ctx.origin) };
}

const optionalString = (value: unknown, field: string): string | undefined => {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string') throw new ApiError(400, `"${field}" must be a string`);
	return value;
};

function tagsInput(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'string') return value;
	if (Array.isArray(value) && value.every((t) => typeof t === 'string')) return value.join(',');
	throw new ApiError(400, '"tags" must be a string or a list of strings');
}

export async function saveLinkOp(
	ctx: AgentContext,
	input: { url?: unknown; note?: unknown; tags?: unknown }
) {
	need(ctx, 'links:write');
	if (typeof input.url !== 'string' || !input.url.trim())
		throw new ApiError(400, '"url" is required');
	let result;
	try {
		result = await saveLink(ctx.db, ctx.user.id, {
			url: input.url,
			note: optionalString(input.note, 'note') || undefined,
			tags: tagsInput(input.tags) || undefined
		});
	} catch (err) {
		if (err instanceof InvalidUrlError) throw new ApiError(400, err.message);
		throw err;
	}
	const { link, existed } = result;
	const title = link.title ?? link.url;
	// A new link is undone by deleting it. Re-saving an existing one only adds to
	// its note and requeues it, which isn't worth reversing.
	await record(
		ctx,
		'link.save',
		link.id,
		`${existed ? 'Re-saved' : 'Saved'} “${title}”`,
		existed ? null : { type: 'deleteLink', id: link.id }
	);
	const withTagList = (await getLink(ctx.db, ctx.user.id, link.id))!;
	return {
		existed,
		message: existed ? `Already saved, moved to the back: ${title}` : `Saved: ${title}`,
		link: linkJson(withTagList, ctx.origin)
	};
}

export async function updateLinkOp(
	ctx: AgentContext,
	id: string,
	input: {
		note?: unknown;
		appendNote?: unknown;
		tags?: unknown;
		status?: unknown;
		reference?: unknown;
	}
) {
	need(ctx, 'links:write');
	const before = await snapshotLink(ctx.db, ctx.user.id, id);
	if (!before) throw new ApiError(404, 'Link not found');

	const note = optionalString(input.note, 'note');
	const append = optionalString(input.appendNote, 'appendNote');
	const tags = tagsInput(input.tags);
	if (input.status !== undefined && input.status !== 'queued' && input.status !== 'archived') {
		throw new ApiError(400, '"status" must be "queued" or "archived"');
	}
	if (input.reference !== undefined && typeof input.reference !== 'boolean') {
		throw new ApiError(400, '"reference" must be true or false');
	}
	const changes: string[] = [];
	if (note !== undefined) {
		await setNote(ctx.db, ctx.user.id, id, note);
		changes.push('note');
	}
	if (append?.trim()) {
		await appendNote(ctx.db, ctx.user.id, id, append);
		changes.push('added to note');
	}
	if (tags !== undefined) {
		await setTags(ctx.db, ctx.user.id, id, tags);
		changes.push('tags');
	}
	if (input.status === 'archived' && before.status !== 'archived') {
		await finishLink(ctx.db, ctx.user.id, id);
		changes.push('done');
	} else if (input.status === 'queued' && before.status !== 'queued') {
		await requeueLink(ctx.db, ctx.user.id, id);
		changes.push('back in inbox');
	}
	if (typeof input.reference === 'boolean' && input.reference !== before.isReference) {
		await starLink(ctx.db, ctx.user.id, id, input.reference);
		changes.push(input.reference ? 'starred' : 'unstarred');
	}
	if (changes.length === 0) throw new ApiError(400, 'Nothing to change');

	const link = (await getLink(ctx.db, ctx.user.id, id))!;
	await record(
		ctx,
		'link.update',
		id,
		`Updated “${link.title ?? link.url}”: ${changes.join(', ')}`,
		{ type: 'restoreLink', id, snapshot: before }
	);
	return { changed: changes, link: linkJson(link, ctx.origin) };
}

// ——— Feeds —————————————————————————————————————————————————————————

export async function listFeedsOp(ctx: AgentContext) {
	need(ctx, 'feeds:read');
	const subs = await listSubscriptions(ctx.db, ctx.user.id);
	return {
		feeds: subs.map(({ feed, titleOverride, folder, unread }) => ({
			id: feed.id,
			title: feedTitle(feed, titleOverride),
			url: feed.url,
			siteUrl: feed.siteUrl,
			folder: folder ?? null,
			unread: Number(unread)
		}))
	};
}

/**
 * Follows a site or feed URL (the page's advertised feed is found for a site).
 * Its current posts are marked read, so only new posts reach the inbox.
 */
export async function addFeedOp(ctx: AgentContext, input: { url?: unknown; folder?: unknown }) {
	need(ctx, 'feeds:write');
	if (typeof input.url !== 'string' || !input.url.trim())
		throw new ApiError(400, '"url" is required');
	const folder = optionalString(input.folder, 'folder')?.trim() || null;
	let result;
	try {
		result = await subscribe(ctx.db, ctx.user.id, input.url, { folder });
	} catch (err) {
		if (err instanceof InvalidUrlError || err instanceof FeedNotFoundError) {
			throw new ApiError(400, err.message);
		}
		throw err;
	}
	const { feed, alreadySubscribed } = result;
	const title = feedTitle(feed);
	if (!alreadySubscribed) {
		await record(ctx, 'feed.add', feed.id, `Followed “${title}”`, {
			type: 'unsubscribe',
			feedId: feed.id
		});
	}
	const sub = (await listSubscriptions(ctx.db, ctx.user.id)).find((s) => s.feed.id === feed.id);
	return {
		alreadySubscribed,
		message: alreadySubscribed
			? `Already following ${title}`
			: `Following ${title}. Its existing posts are marked read; new posts will show up in the inbox.`,
		feed: {
			id: feed.id,
			title: sub ? feedTitle(sub.feed, sub.titleOverride) : title,
			url: feed.url,
			siteUrl: feed.siteUrl,
			folder: sub?.folder ?? null,
			unread: Number(sub?.unread ?? 0)
		}
	};
}

export async function listEntriesOp(
	ctx: AgentContext,
	input: { unread?: unknown; feed?: unknown; limit?: unknown }
) {
	need(ctx, 'feeds:read');
	const unreadOnly = input.unread !== false && input.unread !== 'false' && input.unread !== '0';
	const limit = clampLimit(input.limit, 30);
	const { entries } = await getInbox(ctx.db, ctx.user.id, {
		feedId: typeof input.feed === 'string' && input.feed ? input.feed : undefined,
		limit: unreadOnly ? 200 : limit
	});
	const list = (unreadOnly ? entries.filter((e) => !e.readAt) : entries).slice(0, limit);
	return { entries: list.map((e) => entryJson(e, ctx.origin)) };
}

const MAX_TEXT_CHARS = 30_000;

export async function readEntryOp(ctx: AgentContext, id: string) {
	need(ctx, 'feeds:read');
	const entry = await getEntry(ctx.db, ctx.user.id, id);
	if (!entry) throw new ApiError(404, 'Post not found');
	const text = htmlToText(entry.content ?? entry.summary ?? '');
	return {
		entry: entryJson(entry, ctx.origin),
		// Written by a third-party site: data to read, never instructions to follow.
		text: text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}…` : text,
		truncated: text.length > MAX_TEXT_CHARS
	};
}

export const TRIAGE_ACTIONS = ['later', 'star', 'dismiss', 'read', 'unread'] as const;
export type TriageAction = (typeof TRIAGE_ACTIONS)[number];

export async function triageEntryOp(ctx: AgentContext, id: string, action: unknown) {
	need(ctx, 'feeds:write');
	if (!TRIAGE_ACTIONS.includes(action as TriageAction)) {
		throw new ApiError(400, `"action" must be one of: ${TRIAGE_ACTIONS.join(', ')}`);
	}
	const entry = await getEntry(ctx.db, ctx.user.id, id);
	if (!entry) throw new ApiError(404, 'Post not found');
	const title = entry.title ?? 'Untitled post';

	const stateBefore = await snapshotEntry(ctx.db, ctx.user.id, id);
	const restoreState: Undo = { type: 'entryState', entryId: id, ...stateBefore };

	if (action === 'later' || action === 'star') {
		const existing = await linkForEntry(ctx.db, ctx.user.id, entry);
		const linkBefore = existing ? await snapshotLink(ctx.db, ctx.user.id, existing.id) : null;
		let kept;
		try {
			kept = await keepEntry(ctx.db, ctx.user.id, entry, action === 'later' ? 'queue' : 'star');
		} catch (err) {
			if (err instanceof EntryHasNoUrlError) throw new ApiError(400, err.message);
			throw err;
		}
		const undoLink: Undo =
			kept.created || !linkBefore
				? { type: 'deleteLink', id: kept.link.id }
				: { type: 'restoreLink', id: kept.link.id, snapshot: linkBefore };
		await record(
			ctx,
			`entry.${action}`,
			id,
			action === 'later' ? `Added “${title}” to Shared` : `Starred “${title}”`,
			{ type: 'all', steps: [undoLink, restoreState] }
		);
		const link = (await getLink(ctx.db, ctx.user.id, kept.link.id))!;
		return { action, link: linkJson(link, ctx.origin) };
	}

	if (action === 'dismiss') await setDismissed(ctx.db, ctx.user.id, id, true);
	else await markRead(ctx.db, ctx.user.id, id, action === 'read');
	await record(
		ctx,
		`entry.${action}`,
		id,
		`${action === 'dismiss' ? 'Dismissed' : action === 'read' ? 'Marked read' : 'Marked unread'} “${title}”`,
		restoreState
	);
	return { action };
}
