import { eq, sql } from 'drizzle-orm';
import { feedEntries, feeds, type Db, type Feed } from '../db';
import { parseHttpUrl } from '../url';
import { readHead } from '../metadata';
import { COMMON_FEED_PATHS, discoverFeeds, looksLikeFeed } from './discover';
import { FeedParseError, parseFeed, type ParsedFeed } from './parse';

const USER_AGENT =
	'Mozilla/5.0 (compatible; ReadingList/1.0; +https://reader.nelsonfamily.fyi) FeedFetcher';
const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const BASE_INTERVAL_MS = 60 * 60 * 1000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
// D1 allows 100 bound parameters per statement; an entry insert binds 10.
const ENTRY_ROWS_PER_INSERT = 9;

export class FeedNotFoundError extends Error {}

type FetchFn = typeof fetch;

async function readBody(response: Response): Promise<string> {
	if (!response.body) return '';
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let body = '';
	let bytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		if (bytes > MAX_BODY_BYTES) {
			await reader.cancel();
			throw new Error('Feed is larger than 5 MB');
		}
		body += decoder.decode(value, { stream: true });
	}
	return body + decoder.decode();
}

function get(url: string, fetchFn: FetchFn, headers: Record<string, string> = {}) {
	return fetchFn(url, {
		redirect: 'follow',
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: {
			'user-agent': USER_AGENT,
			accept:
				'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
			...headers
		}
	});
}

export interface FoundFeed {
	/** The feed's own URL after redirects. */
	url: string;
	parsed: ParsedFeed;
	etag: string | null;
	lastModified: string | null;
}

async function tryFeed(url: string, fetchFn: FetchFn): Promise<FoundFeed | null> {
	try {
		const response = await get(url, fetchFn);
		if (!response.ok) {
			await response.body?.cancel();
			return null;
		}
		const body = await readBody(response);
		if (!looksLikeFeed(body, response.headers.get('content-type'))) return null;
		return {
			url: response.url || url,
			parsed: parseFeed(body, response.url || url),
			etag: response.headers.get('etag'),
			lastModified: response.headers.get('last-modified')
		};
	} catch {
		return null;
	}
}

/**
 * Finds the feed for what someone pasted: a feed URL, or a site/page that
 * advertises one, or a site with a feed at a conventional path.
 */
export async function findFeed(input: string, fetchFn: FetchFn = fetch): Promise<FoundFeed> {
	let url = parseHttpUrl(input).toString();
	const schemeGiven = /^[a-z][a-z0-9+.-]*:/i.test(input.trim());
	const unreachable = (err: unknown) =>
		new FeedNotFoundError(`Couldn’t reach ${new URL(url).hostname}: ${(err as Error).message}`);
	let response: Response;
	try {
		response = await get(url, fetchFn);
	} catch (err) {
		// "example.com" was tried as https; fall back to http like a browser would.
		if (schemeGiven) throw unreachable(err);
		try {
			url = url.replace(/^https:/, 'http:');
			response = await get(url, fetchFn);
		} catch {
			throw unreachable(err);
		}
	}
	const finalUrl = response.url || url;
	const type = response.headers.get('content-type');

	if (response.ok && !/html/i.test(type ?? '')) {
		const body = await readBody(response);
		if (looksLikeFeed(body, type)) {
			return {
				url: finalUrl,
				parsed: parseFeed(body, finalUrl),
				etag: response.headers.get('etag'),
				lastModified: response.headers.get('last-modified')
			};
		}
	} else if (response.ok && response.body) {
		const head = await readHead(response.body);
		for (const candidate of discoverFeeds(head, finalUrl)) {
			const found = await tryFeed(candidate.url, fetchFn);
			if (found) return found;
		}
	} else {
		await response.body?.cancel();
	}

	const origin = new URL(finalUrl).origin;
	for (const path of COMMON_FEED_PATHS) {
		const found = await tryFeed(origin + path, fetchFn);
		if (found) return found;
	}
	throw new FeedNotFoundError(`Couldn’t find a feed at ${new URL(url).hostname}`);
}

/** Inserts entries that aren't stored yet. Returns how many were new. */
export async function ingestEntries(db: Db, feedId: string, parsed: ParsedFeed): Promise<number> {
	if (parsed.entries.length === 0) return 0;
	const rows = parsed.entries.map((e) => ({
		feedId,
		guid: e.guid,
		url: e.url,
		title: e.title,
		author: e.author,
		summary: e.summary,
		content: e.content,
		imageUrl: e.imageUrl,
		publishedAt: e.publishedAt
	}));
	const statements = [];
	for (let i = 0; i < rows.length; i += ENTRY_ROWS_PER_INSERT) {
		statements.push(
			db
				.insert(feedEntries)
				.values(rows.slice(i, i + ENTRY_ROWS_PER_INSERT))
				.onConflictDoNothing()
				.returning({ id: feedEntries.id })
		);
	}
	const [first, ...rest] = statements;
	const results = await db.batch([first, ...rest]);
	return results.reduce((n, inserted) => n + inserted.length, 0);
}

const feedDetails = (parsed: ParsedFeed) => ({
	...(parsed.title && { title: parsed.title }),
	...(parsed.siteUrl && { siteUrl: parsed.siteUrl }),
	...(parsed.description && { description: parsed.description })
});

/** Creates the shared feed row (or returns the existing one) and stores its entries. */
export async function upsertFeed(db: Db, found: FoundFeed, now = new Date()) {
	const [feed] = await db
		.insert(feeds)
		.values({
			url: found.url,
			...feedDetails(found.parsed),
			etag: found.etag,
			lastModified: found.lastModified,
			lastFetchedAt: now,
			nextFetchAt: new Date(now.getTime() + BASE_INTERVAL_MS)
		})
		.onConflictDoUpdate({ target: feeds.url, set: { ...feedDetails(found.parsed) } })
		.returning();
	const newEntries = await ingestEntries(db, feed.id, found.parsed);
	return { feed, newEntries };
}

export type RefreshResult =
	| { status: 'updated'; newEntries: number }
	| { status: 'not-modified' }
	| { status: 'error'; error: string };

/**
 * Fetches a feed with a conditional GET and stores new entries. An unchanged
 * feed (304) writes only its fetch times. Errors back off exponentially.
 */
export async function refreshFeed(
	db: Db,
	feed: Feed,
	fetchFn: FetchFn = fetch,
	now = new Date()
): Promise<RefreshResult> {
	const scheduleNext = (ms: number) => new Date(now.getTime() + ms);
	try {
		const response = await get(feed.url, fetchFn, {
			...(feed.etag && { 'if-none-match': feed.etag }),
			...(feed.lastModified && { 'if-modified-since': feed.lastModified })
		});
		if (response.status === 304) {
			await response.body?.cancel();
			await db
				.update(feeds)
				.set({
					lastFetchedAt: now,
					nextFetchAt: scheduleNext(BASE_INTERVAL_MS),
					errorCount: 0,
					lastError: null
				})
				.where(eq(feeds.id, feed.id));
			return { status: 'not-modified' };
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(`HTTP ${response.status}`);
		}
		const body = await readBody(response);
		const parsed = parseFeed(body, response.url || feed.url);
		const newEntries = await ingestEntries(db, feed.id, parsed);
		await db
			.update(feeds)
			.set({
				...feedDetails(parsed),
				etag: response.headers.get('etag'),
				lastModified: response.headers.get('last-modified'),
				lastFetchedAt: now,
				nextFetchAt: scheduleNext(BASE_INTERVAL_MS),
				errorCount: 0,
				lastError: null
			})
			.where(eq(feeds.id, feed.id));
		return { status: 'updated', newEntries };
	} catch (err) {
		const message =
			err instanceof FeedParseError
				? `Not a feed any more: ${err.message}`
				: (err as Error).message;
		const backoff = Math.min(
			MAX_BACKOFF_MS,
			BASE_INTERVAL_MS * 2 ** Math.min(feed.errorCount + 1, 10)
		);
		await db
			.update(feeds)
			.set({
				lastFetchedAt: now,
				nextFetchAt: scheduleNext(backoff),
				errorCount: sql`${feeds.errorCount} + 1`,
				lastError: message.slice(0, 500)
			})
			.where(eq(feeds.id, feed.id));
		return { status: 'error', error: message };
	}
}
