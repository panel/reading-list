import { and, asc, exists, isNull, lte, or, sql } from 'drizzle-orm';
import { feeds, subscriptions, type Db } from '@reading-list/core/db';

/**
 * Subrequests per invocation are capped (50 on Workers Free); each dispatched
 * feed is one, so stay well under it. At ~100 feeds with 30 min–6 h intervals,
 * fewer than this come due in a 15-minute tick.
 */
export const MAX_FEEDS_PER_TICK = 40;
// (The cron also dispatches up to MAX_ARCHIVES_PER_RUN readable copies and
// MAX_SCORES_PER_RUN predictions: 48 in all.)

/** Feeds that someone follows and that are due for a check, most overdue first. */
export function dueFeeds(db: Db, now: Date, limit = MAX_FEEDS_PER_TICK) {
	return db
		.select({ id: feeds.id, url: feeds.url })
		.from(feeds)
		.where(
			and(
				or(isNull(feeds.nextFetchAt), lte(feeds.nextFetchAt, now)),
				exists(
					db
						.select({ one: sql`1` })
						.from(subscriptions)
						.where(sql`${subscriptions.feedId} = ${feeds.id}`)
				)
			)
		)
		.orderBy(sql`${feeds.nextFetchAt} is not null`, asc(feeds.nextFetchAt))
		.limit(limit);
}

/** The daily cleanup schedule; must match a cron in wrangler.jsonc (tested). */
export const PRUNE_CRON = '47 3 * * *';

const POLL_PATH = /^\/poll\/([0-9A-HJKMNP-TV-Z]{26})$/;

export const pollUrl = (feedId: string) => `https://fetcher.internal/poll/${feedId}`;

/** The feed id from a /poll/:id request, or null. */
export function matchPoll(request: Request): string | null {
	if (request.method !== 'POST') return null;
	return new URL(request.url).pathname.match(POLL_PATH)?.[1] ?? null;
}

/** Readable copies captured per cron tick or per kick; each is one subrequest. */
export const MAX_ARCHIVES_PER_RUN = 5;

const ARCHIVE_PATH = /^\/archive\/([0-9A-HJKMNP-TV-Z]{26})$/;

export const archiveUrl = (linkId: string) => `https://fetcher.internal/archive/${linkId}`;
/** Called by the web app (FETCHER binding) after a change that may need a copy. */
export const KICK_URL = 'https://fetcher.internal/archive/kick';

/** The link id from a POST /archive/:id request, or null. */
export function matchArchive(request: Request): string | null {
	if (request.method !== 'POST') return null;
	return new URL(request.url).pathname.match(ARCHIVE_PATH)?.[1] ?? null;
}

export const isKick = (request: Request) =>
	request.method === 'POST' && new URL(request.url).pathname === '/archive/kick';

/** Inbox items scored per cron tick (Slice 12c); each is one subrequest. */
export const MAX_SCORES_PER_RUN = 3;

const ID = '[0-9A-Za-z]{1,40}';
const SCORE_PATH = new RegExp(`^/score/(post|link)/(${ID})/(${ID})$`);

export const scoreUrl = (kind: 'post' | 'link', userId: string, itemId: string) =>
	`https://fetcher.internal/score/${kind}/${userId}/${itemId}`;

/** The item from a POST /score/:kind/:userId/:itemId request, or null. */
export function matchScore(
	request: Request
): { kind: 'post' | 'link'; userId: string; itemId: string } | null {
	if (request.method !== 'POST') return null;
	const m = new URL(request.url).pathname.match(SCORE_PATH);
	return m ? { kind: m[1] as 'post' | 'link', userId: m[2], itemId: m[3] } : null;
}
