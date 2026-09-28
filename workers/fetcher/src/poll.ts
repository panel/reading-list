import { and, asc, exists, isNull, lte, or, sql } from 'drizzle-orm';
import { feeds, subscriptions, type Db } from '@reading-list/core/db';

/**
 * Subrequests per invocation are capped (50 on Workers Free); each dispatched
 * feed is one, so stay well under it. At ~100 feeds with 30 min–6 h intervals,
 * fewer than this come due in a 15-minute tick.
 */
export const MAX_FEEDS_PER_TICK = 40;

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

const POLL_PATH = /^\/poll\/([0-9A-HJKMNP-TV-Z]{26})$/;

export const pollUrl = (feedId: string) => `https://fetcher.internal/poll/${feedId}`;

/** The feed id from a /poll/:id request, or null. */
export function matchPoll(request: Request): string | null {
	if (request.method !== 'POST') return null;
	return new URL(request.url).pathname.match(POLL_PATH)?.[1] ?? null;
}
