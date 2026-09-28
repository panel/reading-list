import { extractMetadata, readHead, type PageMetadata } from '@reading-list/core';

const TIMEOUT_MS = 6000;
const USER_AGENT =
	'Mozilla/5.0 (compatible; ReadingList/1.0; +https://reader.nelsonfamily.fyi) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

export interface FetchedPage {
	/** Where the request ended up after redirects (e.g. a t.co link resolved). */
	finalUrl: string;
	metadata: PageMetadata | null;
}

/**
 * Fetches a page and pulls preview metadata from its <head>. Never throws:
 * if the page can't be fetched or isn't HTML, metadata is null and the link is
 * saved with just its URL.
 */
export async function fetchPageMetadata(
	url: string,
	fetchFn: typeof fetch = fetch
): Promise<FetchedPage> {
	try {
		const response = await fetchFn(url, {
			redirect: 'follow',
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: {
				'user-agent': USER_AGENT,
				accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
				'accept-language': 'en'
			}
		});
		const finalUrl = response.url || url;
		const type = response.headers.get('content-type') ?? '';
		if (!response.ok || !response.body || !/html/i.test(type)) {
			await response.body?.cancel();
			return { finalUrl, metadata: null };
		}
		const head = await readHead(response.body);
		return { finalUrl, metadata: extractMetadata(head, finalUrl) };
	} catch (err) {
		console.warn('fetchPageMetadata failed', url, err);
		return { finalUrl: url, metadata: null };
	}
}
