import { XMLParser } from 'fast-xml-parser';

export interface OpmlFeed {
	url: string;
	title: string | null;
	siteUrl: string | null;
	/** The enclosing outline's title, when feeds are grouped (one level, like most readers). */
	folder: string | null;
}

export class OpmlParseError extends Error {}

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '',
	parseAttributeValue: false,
	processEntities: true,
	htmlEntities: true,
	isArray: (name) => name === 'outline'
});

type Outline = Record<string, unknown> & { outline?: Outline[] };

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function httpUrl(value: string | null): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
}

/** Reads the feeds out of an OPML subscription list (from any feed reader). */
export function parseOpml(xml: string): OpmlFeed[] {
	let doc: Record<string, unknown>;
	try {
		doc = parser.parse(xml);
	} catch (err) {
		throw new OpmlParseError(`Not valid XML: ${(err as Error).message}`);
	}
	const body = (doc.opml as Record<string, unknown> | undefined)?.body as Outline | undefined;
	if (!body) throw new OpmlParseError('Not an OPML file');

	const feeds: OpmlFeed[] = [];
	const seen = new Set<string>();
	const walk = (outlines: Outline[] | undefined, folder: string | null) => {
		for (const outline of outlines ?? []) {
			const url = httpUrl(str(outline.xmlUrl) ?? str(outline.xmlurl));
			const title = str(outline.title) ?? str(outline.text);
			if (url) {
				if (!seen.has(url)) {
					seen.add(url);
					feeds.push({ url, title, siteUrl: httpUrl(str(outline.htmlUrl)), folder });
				}
			} else if (outline.outline) {
				// A grouping outline. Nested groups flatten into the top-level folder.
				walk(outline.outline, folder ?? title);
			}
		}
	};
	walk(body.outline, null);
	return feeds;
}

const escape = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function outline(feed: OpmlFeed, indent: string) {
	const title = escape(feed.title ?? feed.url);
	const html = feed.siteUrl ? ` htmlUrl="${escape(feed.siteUrl)}"` : '';
	return `${indent}<outline type="rss" text="${title}" title="${title}" xmlUrl="${escape(feed.url)}"${html}/>`;
}

/** Writes feeds as OPML 2.0, grouping foldered feeds under one outline per folder. */
export function toOpml(
	feeds: OpmlFeed[],
	title = 'Reading List subscriptions',
	now = new Date()
): string {
	const folders = new Map<string, OpmlFeed[]>();
	const loose: OpmlFeed[] = [];
	for (const feed of feeds) {
		if (feed.folder) folders.set(feed.folder, [...(folders.get(feed.folder) ?? []), feed]);
		else loose.push(feed);
	}
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<opml version="2.0">',
		'  <head>',
		`    <title>${escape(title)}</title>`,
		`    <dateCreated>${now.toUTCString()}</dateCreated>`,
		'  </head>',
		'  <body>'
	];
	for (const [folder, list] of [...folders].sort(([a], [b]) => a.localeCompare(b))) {
		lines.push(`    <outline text="${escape(folder)}" title="${escape(folder)}">`);
		for (const feed of list) lines.push(outline(feed, '      '));
		lines.push('    </outline>');
	}
	for (const feed of loose) lines.push(outline(feed, '    '));
	lines.push('  </body>', '</opml>', '');
	return lines.join('\n');
}
