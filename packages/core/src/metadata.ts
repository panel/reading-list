export interface PageMetadata {
	title: string | null;
	description: string | null;
	siteName: string | null;
	author: string | null;
	imageUrl: string | null;
	faviconUrl: string | null;
	/** From <link rel="canonical"> or og:url, when present and usable. */
	canonicalUrl: string | null;
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	hellip: '…',
	mdash: '—',
	ndash: '–',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
	middot: '·',
	copy: '©'
};

export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
		if (entity[0] === '#') {
			const code =
				entity[1] === 'x' || entity[1] === 'X'
					? parseInt(entity.slice(2), 16)
					: parseInt(entity.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: match;
		}
		return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
	});
}

function clean(value: string | undefined | null, maxLength: number): string | null {
	if (!value) return null;
	const text = decodeEntities(value).replace(/\s+/g, ' ').trim();
	if (!text) return null;
	return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

function resolveHttpUrl(value: string | undefined | null, base: string): string | null {
	if (!value) return null;
	try {
		const url = new URL(decodeEntities(value.trim()), base);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
}

const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttributes(source: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	for (const match of source.matchAll(ATTRIBUTE)) {
		const name = match[1].toLowerCase();
		if (!(name in attributes)) attributes[name] = match[2] ?? match[3] ?? match[4] ?? '';
	}
	return attributes;
}

/**
 * Pulls preview metadata (Open Graph, Twitter cards, standard <meta>/<link>
 * tags and <title>) out of a page's HTML. Only the <head> is needed.
 */
export function extractMetadata(html: string, pageUrl: string): PageMetadata {
	// Comments and scripts can contain tag-like text; drop them first.
	const source = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');

	const meta = new Map<string, string>();
	const links: Record<string, string>[] = [];

	for (const match of source.matchAll(/<(meta|link)\b([^>]*)>/gi)) {
		const attributes = parseAttributes(match[2]);
		if (match[1].toLowerCase() === 'link') {
			links.push(attributes);
			continue;
		}
		const key = (attributes.property ?? attributes.name ?? attributes.itemprop)?.toLowerCase();
		const content = attributes.content;
		// First occurrence wins, which is how Open Graph consumers treat duplicates.
		if (key && content && !meta.has(key)) meta.set(key, content);
	}

	const titleTag = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
	const first = (...keys: string[]) => keys.map((k) => meta.get(k)).find(Boolean);

	const author = first('author', 'article:author', 'parsely-author', 'dc.creator');

	const linkHref = (predicate: (rel: string[]) => boolean) =>
		links.find((l) => l.href && predicate((l.rel ?? '').toLowerCase().split(/\s+/)))?.href;

	const favicon =
		linkHref((rel) => rel.includes('apple-touch-icon')) ??
		linkHref((rel) => rel.includes('icon')) ??
		'/favicon.ico';

	return {
		title: clean(first('og:title', 'twitter:title') ?? titleTag, 300),
		description: clean(first('og:description', 'twitter:description', 'description'), 1000),
		siteName: clean(first('og:site_name', 'application-name'), 120),
		// article:author is often a profile URL rather than a name.
		author: author && !/^https?:\/\//i.test(author) ? clean(author, 120) : null,
		imageUrl: resolveHttpUrl(
			first(
				'og:image:secure_url',
				'og:image',
				'og:image:url',
				'twitter:image',
				'twitter:image:src'
			),
			pageUrl
		),
		faviconUrl: resolveHttpUrl(favicon, pageUrl),
		canonicalUrl: resolveHttpUrl(
			linkHref((rel) => rel.includes('canonical')) ?? meta.get('og:url'),
			pageUrl
		)
	};
}

/**
 * Reads a response body only as far as the end of <head> (or `maxBytes`),
 * which is all extractMetadata needs, then cancels the rest of the download.
 */
export async function readHead(
	body: ReadableStream<Uint8Array>,
	maxBytes = 512 * 1024
): Promise<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let html = '';
	let bytes = 0;
	try {
		while (bytes < maxBytes) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			html += decoder.decode(value, { stream: true });
			if (/<\/head\s*>|<body[\s>]/i.test(html)) break;
		}
	} finally {
		reader.cancel().catch(() => {});
	}
	return html;
}
