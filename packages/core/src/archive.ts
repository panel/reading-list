/**
 * Readable copies of saved links (Slice 11). Rows in link_archives are created
 * and given their keep_until by triggers on `links` (migration 0011); this
 * module fills them in. The fetcher claims pending rows and captures each in
 * its own invocation, so every page gets its own CPU budget.
 */
import { and, desc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { articleFromHtml, extractArticle, type Article } from './article';
import { feedEntries, linkArchives, links, type Db } from './db';

/** Fewer words than this isn't an article (a login wall, an app shell, a teaser). */
export const MIN_WORDS = 100;
/** Captures that fail for a reason that might pass (timeouts, 5xx) are retried this often. */
export const MAX_ATTEMPTS = 3;
/** A claimed capture that hasn't finished by then (e.g. it hit the CPU limit) is retried. */
const STALE_CLAIM_MS = 10 * 60 * 1000;
const RETRY_AFTER_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;

const USER_AGENT =
	'Mozilla/5.0 (compatible; ReadingList/1.0; +https://reader.nelsonfamily.fyi) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

/**
 * Marks up to `limit` copies as being fetched and returns their link ids:
 * pending ones, failed ones due a retry, and claims that went stale. Copies
 * that went stale on their last attempt are marked failed instead.
 */
export async function claimArchives(db: Db, limit: number, now = new Date()): Promise<string[]> {
	const t = now.getTime();
	await db
		.update(linkArchives)
		.set({ status: 'failed', lastError: 'The page took too long to process', updatedAt: now })
		.where(
			and(
				eq(linkArchives.status, 'fetching'),
				lt(linkArchives.claimedAt, new Date(t - STALE_CLAIM_MS)),
				sql`${linkArchives.attempts} >= ${MAX_ATTEMPTS}`
			)
		);
	const due = db
		.select({ id: linkArchives.linkId })
		.from(linkArchives)
		.where(
			or(
				eq(linkArchives.status, 'pending'),
				and(
					eq(linkArchives.status, 'fetching'),
					lt(linkArchives.claimedAt, new Date(t - STALE_CLAIM_MS))
				),
				and(
					eq(linkArchives.status, 'failed'),
					sql`${linkArchives.attempts} < ${MAX_ATTEMPTS}`,
					sql`${linkArchives.updatedAt} < ${t} - ${RETRY_AFTER_MS} * ${linkArchives.attempts}`
				)
			)
		)
		// Newest requests first: a link just saved matters more than the backlog.
		.orderBy(desc(linkArchives.updatedAt))
		.limit(limit);
	const claimed = await db
		.update(linkArchives)
		.set({
			status: 'fetching',
			claimedAt: now,
			attempts: sql`${linkArchives.attempts} + 1`,
			updatedAt: now
		})
		.where(inArray(linkArchives.linkId, due))
		.returning({ id: linkArchives.linkId });
	return claimed.map((c) => c.id);
}

/** Asks for a fresh copy (the Retry / "Make a readable copy" button). */
export async function requestArchive(db: Db, linkId: string, now = new Date()) {
	await db
		.insert(linkArchives)
		.values({ linkId, status: 'pending', updatedAt: now })
		.onConflictDoUpdate({
			target: linkArchives.linkId,
			set: { status: 'pending', attempts: 0, lastError: null, updatedAt: now }
		});
	// A link that's Done and not starred keeps a requested copy for 14 days.
	await db.run(sql`
		update link_archives set keep_until = ${now.getTime()} + 1209600000
		where link_id = ${linkId} and keep_until is null
			and exists (select 1 from links l where l.id = ${linkId}
				and l.status <> 'queued' and not l.is_reference)
	`);
}

class CaptureError extends Error {
	constructor(
		message: string,
		/** False when trying again won't help (not HTML, no article, 404). */
		readonly retry: boolean
	) {
		super(message);
	}
}

async function readPage(response: Response): Promise<string> {
	if (!response.body) return '';
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let body = '';
	let bytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		body += decoder.decode(value, { stream: true });
		// The article is near the top; stop reading rather than fail.
		if (bytes > MAX_PAGE_BYTES) {
			await reader.cancel();
			return body;
		}
	}
	return body + decoder.decode();
}

async function fetchArticle(url: string, fetchFn: typeof fetch): Promise<Article> {
	let response: Response;
	try {
		response = await fetchFn(url, {
			redirect: 'follow',
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: {
				'user-agent': USER_AGENT,
				accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
				'accept-language': 'en'
			}
		});
	} catch (err) {
		const timedOut = (err as Error).name === 'TimeoutError';
		throw new CaptureError(
			timedOut ? 'The site took too long to answer' : 'Couldn’t reach the site',
			true
		);
	}
	if (!response.ok) {
		await response.body?.cancel();
		const retry = response.status >= 500 || response.status === 408 || response.status === 429;
		const blocked = response.status === 401 || response.status === 403;
		throw new CaptureError(
			blocked
				? `The site refused the request (HTTP ${response.status})`
				: `HTTP ${response.status}`,
			retry
		);
	}
	const type = response.headers.get('content-type') ?? '';
	if (type && !/html|xml/i.test(type)) {
		await response.body?.cancel();
		throw new CaptureError(`Not a web page (${type.split(';')[0]})`, false);
	}
	const article = extractArticle(await readPage(response), response.url || url);
	if (!article) throw new CaptureError('Couldn’t find an article on the page', false);
	return article;
}

/** A feed post's content for this link, if any feed has one. */
async function feedArticle(
	db: Db,
	link: { sourceEntryId: string | null; url: string; canonicalUrl: string }
): Promise<Article | null> {
	const urls = [...new Set([link.url, link.canonicalUrl])];
	const [row] = await db
		.select({ content: feedEntries.content })
		.from(feedEntries)
		.where(
			and(
				isNotNull(feedEntries.content),
				link.sourceEntryId
					? or(eq(feedEntries.id, link.sourceEntryId), inArray(feedEntries.url, urls))
					: inArray(feedEntries.url, urls)
			)
		)
		.orderBy(sql`${feedEntries.id} = ${link.sourceEntryId ?? ''} desc`, desc(feedEntries.createdAt))
		.limit(1);
	return row?.content ? articleFromHtml(row.content) : null;
}

export type CaptureResult =
	| { status: 'ready'; source: 'page' | 'feed'; words: number }
	| { status: 'failed'; error: string; retry: boolean }
	| { status: 'skipped' };

/**
 * Makes the readable copy for one link: a feed post's full text when a feed
 * has it (no fetch needed, and the most faithful copy), else the article
 * extracted from the page. A short feed post beats nothing.
 */
export async function captureArchive(
	db: Db,
	linkId: string,
	fetchFn: typeof fetch = fetch,
	now = new Date()
): Promise<CaptureResult> {
	const link = await db.query.links.findFirst({ where: eq(links.id, linkId) });
	const row = await db.query.linkArchives.findFirst({ where: eq(linkArchives.linkId, linkId) });
	if (!link || !row || row.status === 'ready') return { status: 'skipped' };

	const save = (article: Article, source: 'page' | 'feed') =>
		db
			.update(linkArchives)
			.set({
				status: 'ready',
				source,
				html: article.html,
				text: article.text,
				words: article.words,
				lastError: null,
				claimedAt: null,
				capturedAt: now,
				updatedAt: now
			})
			.where(eq(linkArchives.linkId, linkId));

	const fromFeed = await feedArticle(db, link);
	if (fromFeed && fromFeed.words >= MIN_WORDS) {
		await save(fromFeed, 'feed');
		return { status: 'ready', source: 'feed', words: fromFeed.words };
	}

	let failure: CaptureError;
	try {
		const article = await fetchArticle(link.url, fetchFn);
		if (article.words >= MIN_WORDS) {
			await save(article, 'page');
			return { status: 'ready', source: 'page', words: article.words };
		}
		failure = new CaptureError('Couldn’t find enough text on the page', false);
	} catch (err) {
		if (!(err instanceof CaptureError)) throw err;
		failure = err;
	}
	if (fromFeed && fromFeed.words > 0) {
		await save(fromFeed, 'feed');
		return { status: 'ready', source: 'feed', words: fromFeed.words };
	}
	await db
		.update(linkArchives)
		.set({
			status: 'failed',
			lastError: failure.message,
			claimedAt: null,
			updatedAt: now,
			...(!failure.retry && { attempts: MAX_ATTEMPTS })
		})
		.where(eq(linkArchives.linkId, linkId));
	return { status: 'failed', error: failure.message, retry: failure.retry };
}

/** Deletes copies past their keep_until (Done, not starred, 14 days ago). */
export async function pruneArchives(db: Db, now = new Date()): Promise<number> {
	const deleted = await db
		.delete(linkArchives)
		.where(lt(linkArchives.keepUntil, now))
		.returning({ id: linkArchives.linkId });
	return deleted.length;
}
