import { parseAttributes } from '../metadata';

const FEED_TYPES = new Set([
	'application/rss+xml',
	'application/atom+xml',
	'application/feed+json',
	'application/json',
	'application/rdf+xml',
	'text/xml',
	'application/xml'
]);

/** Paths many blogs serve a feed at, tried when a page doesn't advertise one. */
export const COMMON_FEED_PATHS = [
	'/feed',
	'/rss.xml',
	'/atom.xml',
	'/feed.xml',
	'/index.xml',
	'/rss'
];

export interface DiscoveredFeed {
	url: string;
	title: string | null;
	type: string;
}

/** Feeds a page advertises with <link rel="alternate" type="application/rss+xml" …>. */
export function discoverFeeds(html: string, pageUrl: string): DiscoveredFeed[] {
	const found: DiscoveredFeed[] = [];
	const source = html.replace(/<!--[\s\S]*?-->/g, '');
	for (const match of source.matchAll(/<link\b([^>]*)>/gi)) {
		const attributes = parseAttributes(match[1]);
		const rel = (attributes.rel ?? '').toLowerCase().split(/\s+/);
		const type = (attributes.type ?? '').toLowerCase().split(';')[0].trim();
		if (!rel.includes('alternate') || !FEED_TYPES.has(type) || !attributes.href) continue;
		// application/json alternates are often API endpoints (e.g. WordPress oEmbed); only
		// accept them when they look like a feed.
		if (type === 'application/json' && !/feed/i.test(attributes.href)) continue;
		try {
			const url = new URL(attributes.href, pageUrl).toString();
			if (!found.some((f) => f.url === url)) {
				found.push({ url, title: attributes.title?.trim() || null, type });
			}
		} catch {
			// ignore malformed hrefs
		}
	}
	// Comment feeds are rarely what anyone wants to follow.
	return found.sort(
		(a, b) => Number(/comment/i.test(a.title ?? a.url)) - Number(/comment/i.test(b.title ?? b.url))
	);
}

/** Whether a response body looks like a feed rather than a web page. */
export function looksLikeFeed(body: string, contentType: string | null): boolean {
	const type = (contentType ?? '').toLowerCase();
	if (/(rss|atom|feed\+json|rdf)/.test(type)) return true;
	const head = body.trimStart().slice(0, 1000);
	if (head.startsWith('{')) return /"version"\s*:\s*"https:\/\/jsonfeed\.org/.test(head);
	return /<(rss|feed|rdf:RDF)[\s>]/.test(head);
}
