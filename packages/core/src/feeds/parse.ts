import { XMLParser } from 'fast-xml-parser';
import { decodeEntities } from '../metadata';

export interface ParsedEntry {
	/** Stable per-feed identity: the item's guid/id, else its link, else title + date. */
	guid: string;
	url: string | null;
	title: string | null;
	author: string | null;
	/** Plain text, short: for lists and previews. */
	summary: string | null;
	/** Raw HTML as published. Sanitize before rendering. */
	content: string | null;
	imageUrl: string | null;
	publishedAt: Date | null;
}

export interface ParsedFeed {
	format: 'rss' | 'atom' | 'rdf' | 'json';
	title: string | null;
	siteUrl: string | null;
	description: string | null;
	entries: ParsedEntry[];
}

export class FeedParseError extends Error {}

const MAX_ENTRIES = 50;
const MAX_CONTENT_CHARS = 400_000;
const SUMMARY_CHARS = 400;

const xml = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	textNodeName: '#text',
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: true,
	processEntities: true,
	htmlEntities: true,
	isArray: (name) =>
		['item', 'entry', 'link', 'category', 'enclosure', 'media:content'].includes(name)
});

type Node = Record<string, unknown> | string | undefined | null;

/** Text of an XML node, whether it parsed as a string or as { '#text': … }. */
function text(node: unknown): string | null {
	if (node == null) return null;
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (Array.isArray(node)) return text(node[0]);
	if (typeof node === 'object') {
		const value = (node as Record<string, unknown>)['#text'];
		if (value != null) return String(value);
	}
	return null;
}

const attr = (node: unknown, name: string): string | null => {
	if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
	const value = (node as Record<string, unknown>)[`@_${name}`];
	return value == null ? null : String(value);
};

const list = <T>(value: T | T[] | undefined | null): T[] =>
	value == null ? [] : Array.isArray(value) ? value : [value];

export function stripTags(html: string): string {
	return decodeEntities(
		html
			.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
			.replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, ' ')
			.replace(/<[^>]*>/g, '')
	)
		.replace(/\s+/g, ' ')
		.trim();
}

function cleanTitle(value: string | null): string | null {
	if (!value) return null;
	const title = stripTags(value);
	return title ? title.slice(0, 500) : null;
}

function summarize(html: string | null): string | null {
	if (!html) return null;
	const plain = stripTags(html);
	if (!plain) return null;
	return plain.length > SUMMARY_CHARS
		? `${plain.slice(0, SUMMARY_CHARS).replace(/\s+\S*$/, '')}…`
		: plain;
}

function absolute(value: string | null, base: string | null): string | null {
	if (!value) return null;
	try {
		const url = new URL(value.trim(), base ?? undefined);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
}

function date(value: string | null): Date | null {
	if (!value) return null;
	const parsed = new Date(value.trim());
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function firstImage(html: string | null, base: string | null): string | null {
	const src = html?.match(/<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i)?.[1];
	return absolute(src ? decodeEntities(src) : null, base);
}

function capContent(html: string | null): string | null {
	if (!html) return null;
	return html.length > MAX_CONTENT_CHARS ? html.slice(0, MAX_CONTENT_CHARS) : html;
}

function finishEntry(
	entry: Omit<ParsedEntry, 'guid'> & { guid: string | null }
): ParsedEntry | null {
	const guid =
		entry.guid?.trim() ||
		entry.url ||
		(entry.title ? `${entry.title}|${entry.publishedAt?.toISOString() ?? ''}` : null);
	if (!guid) return null;
	return { ...entry, guid: guid.slice(0, 1000) };
}

function parseRssItem(item: Record<string, unknown>, base: string | null): ParsedEntry | null {
	// <guid> doubles as the permalink unless isPermaLink="false".
	const guid = text(item.guid);
	const guidUrl =
		guid && attr(item.guid, 'isPermaLink') !== 'false' && /^https?:\/\//i.test(guid) ? guid : null;
	const url = absolute(text(item.link) ?? guidUrl, base);
	const content = text(item['content:encoded']) ?? text(item.description);
	const mediaImage =
		attr(item['media:thumbnail'], 'url') ??
		list(item['media:content'] as Node[])
			.map((m) =>
				attr(m, 'medium') === 'image' || /^image\//.test(attr(m, 'type') ?? '')
					? attr(m, 'url')
					: null
			)
			.find(Boolean) ??
		list(item.enclosure as Node[])
			.map((e) => (/^image\//.test(attr(e, 'type') ?? '') ? attr(e, 'url') : null))
			.find(Boolean) ??
		null;
	return finishEntry({
		guid,
		url,
		title: cleanTitle(text(item.title)),
		author: cleanTitle(text(item['dc:creator']) ?? text(item.author)),
		summary: summarize(text(item.description) ?? content),
		content: capContent(content),
		imageUrl: absolute(mediaImage, base) ?? firstImage(content, url ?? base),
		publishedAt: date(text(item.pubDate) ?? text(item['dc:date']))
	});
}

function atomLink(links: unknown, rel = 'alternate'): string | null {
	const all = list(links as Node[]);
	const match =
		all.find((l) => (attr(l, 'rel') ?? 'alternate') === rel) ??
		(rel === 'alternate' ? all[0] : undefined);
	return attr(match, 'href') ?? text(match);
}

function parseAtomEntry(entry: Record<string, unknown>, base: string | null): ParsedEntry | null {
	const url = absolute(atomLink(entry.link), base);
	const content = text(entry.content);
	const summary = text(entry.summary);
	const author = entry.author as Record<string, unknown> | undefined;
	return finishEntry({
		guid: text(entry.id),
		url,
		title: cleanTitle(text(entry.title)),
		author: cleanTitle(text(author?.name) ?? text(author)),
		summary: summarize(summary ?? content),
		content: capContent(content ?? summary),
		imageUrl:
			absolute(attr(entry['media:thumbnail'], 'url'), base) ??
			firstImage(content ?? summary, url ?? base),
		publishedAt: date(text(entry.published) ?? text(entry.updated))
	});
}

function parseJsonFeed(body: string, feedUrl: string): ParsedFeed {
	let data: Record<string, unknown>;
	try {
		data = JSON.parse(body);
	} catch {
		throw new FeedParseError('Not valid JSON');
	}
	if (!Array.isArray(data.items)) throw new FeedParseError('JSON Feed has no items');
	const siteUrl = absolute(
		typeof data.home_page_url === 'string' ? data.home_page_url : null,
		feedUrl
	);
	const str = (v: unknown) => (typeof v === 'string' ? v : null);
	const entries = (data.items as Record<string, unknown>[])
		.slice(0, MAX_ENTRIES)
		.flatMap((item) => {
			const url = absolute(str(item.url) ?? str(item.external_url), siteUrl ?? feedUrl);
			const authors = (item.authors as Record<string, unknown>[] | undefined) ?? [];
			const author =
				str(authors[0]?.name) ?? str((item.author as Record<string, unknown> | undefined)?.name);
			const content =
				str(item.content_html) ??
				(str(item.content_text) ? escapeText(str(item.content_text)!) : null);
			const parsed = finishEntry({
				guid: item.id == null ? null : String(item.id),
				url,
				title: cleanTitle(str(item.title)),
				author: cleanTitle(author),
				summary: summarize(str(item.summary) ?? content),
				content: capContent(content),
				imageUrl:
					absolute(str(item.image) ?? str(item.banner_image), url ?? feedUrl) ??
					firstImage(content, url),
				publishedAt: date(str(item.date_published) ?? str(item.date_modified))
			});
			return parsed ? [parsed] : [];
		});
	return {
		format: 'json',
		title: cleanTitle(str(data.title)),
		siteUrl,
		description: summarize(str(data.description)),
		entries
	};
}

function escapeText(value: string): string {
	return value
		.split(/\n{2,}/)
		.map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
		.join('');
}

/** Parses an RSS 2.0, RSS 1.0 (RDF), Atom or JSON Feed document. */
export function parseFeed(body: string, feedUrl: string): ParsedFeed {
	const trimmed = body.trimStart();
	if (trimmed.startsWith('{')) return parseJsonFeed(trimmed, feedUrl);

	let doc: Record<string, unknown>;
	try {
		doc = xml.parse(trimmed);
	} catch (err) {
		throw new FeedParseError(`Not valid XML: ${(err as Error).message}`);
	}

	const rss = doc.rss as Record<string, unknown> | undefined;
	if (rss?.channel) {
		const channel = (Array.isArray(rss.channel) ? rss.channel[0] : rss.channel) as Record<
			string,
			unknown
		>;
		const siteUrl = absolute(
			list(channel.link as Node[])
				.map((l) => text(l))
				.find(Boolean) ?? null,
			feedUrl
		);
		return {
			format: 'rss',
			title: cleanTitle(text(channel.title)),
			siteUrl,
			description: summarize(text(channel.description)),
			entries: list(channel.item as Record<string, unknown>[])
				.slice(0, MAX_ENTRIES)
				.flatMap((item) => parseRssItem(item, siteUrl ?? feedUrl) ?? [])
		};
	}

	const feed = doc.feed as Record<string, unknown> | undefined;
	if (feed) {
		const siteUrl = absolute(atomLink(feed.link), feedUrl);
		return {
			format: 'atom',
			title: cleanTitle(text(feed.title)),
			siteUrl,
			description: summarize(text(feed.subtitle)),
			entries: list(feed.entry as Record<string, unknown>[])
				.slice(0, MAX_ENTRIES)
				.flatMap((entry) => parseAtomEntry(entry, siteUrl ?? feedUrl) ?? [])
		};
	}

	const rdf = doc['rdf:RDF'] as Record<string, unknown> | undefined;
	if (rdf) {
		const channel = rdf.channel as Record<string, unknown> | undefined;
		const siteUrl = absolute(text(channel?.link), feedUrl);
		return {
			format: 'rdf',
			title: cleanTitle(text(channel?.title)),
			siteUrl,
			description: summarize(text(channel?.description)),
			entries: list(rdf.item as Record<string, unknown>[])
				.slice(0, MAX_ENTRIES)
				.flatMap((item) => parseRssItem(item, siteUrl ?? feedUrl) ?? [])
		};
	}

	throw new FeedParseError('Not an RSS, Atom or JSON feed');
}
