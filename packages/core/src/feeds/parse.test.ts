import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FeedParseError, parseFeed, stripTags } from './parse';
import { discoverFeeds, looksLikeFeed } from './discover';

const fixture = (name: string) =>
	readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('parseFeed: RSS 2.0', () => {
	const feed = parseFeed(fixture('rss.xml'), 'https://blog.example.com/feed.xml');

	it('reads the channel', () => {
		expect(feed).toMatchObject({
			format: 'rss',
			title: 'Example & Co. Blog',
			siteUrl: 'https://blog.example.com/',
			description: 'Writing about things'
		});
	});

	it('reads items and skips ones with no identity', () => {
		expect(feed.entries).toHaveLength(2);
		expect(feed.entries[0]).toMatchObject({
			guid: 'post-42',
			url: 'https://blog.example.com/posts/boring',
			title: 'Choosing "boring" tech',
			author: 'Ada Lovelace',
			summary: 'Short summary with markup.',
			imageUrl: 'https://blog.example.com/img/cover.jpg'
		});
		expect(feed.entries[0].publishedAt?.toISOString()).toBe('2026-09-22T14:30:00.000Z');
		expect(feed.entries[0].content).toContain('<a href="/relative">');
	});

	it('uses a permalink guid as the URL, media:thumbnail as the image, and tolerates bad dates', () => {
		expect(feed.entries[1]).toMatchObject({
			guid: 'https://blog.example.com/posts/guid-only',
			url: 'https://blog.example.com/posts/guid-only',
			imageUrl: 'https://cdn.example.com/thumb.png',
			publishedAt: null,
			content: '<p>Escaped HTML body</p>',
			summary: 'Escaped HTML body'
		});
	});
});

describe('parseFeed: Atom', () => {
	const feed = parseFeed(fixture('atom.xml'), 'https://atom.example.org/feed.atom');

	it('reads the feed and resolves relative links', () => {
		expect(feed).toMatchObject({
			format: 'atom',
			title: 'Atom Writer',
			siteUrl: 'https://atom.example.org/'
		});
		expect(feed.entries[0]).toMatchObject({
			guid: 'tag:atom.example.org,2026:1',
			url: 'https://atom.example.org/2026/09/entry-one',
			title: 'A title with markup',
			author: 'Grace Hopper',
			summary: 'The summary.',
			content: '<p>Full <strong>content</strong>.</p>'
		});
		expect(feed.entries[0].publishedAt?.toISOString()).toBe('2026-09-19T08:00:00.000Z');
	});

	it('falls back to updated and to summary for content', () => {
		expect(feed.entries[1].publishedAt?.toISOString()).toBe('2026-09-18T08:00:00.000Z');
		expect(feed.entries[1].content).toBe('Plain summary only.');
	});
});

describe('parseFeed: JSON Feed', () => {
	const feed = parseFeed(fixture('feed.json'), 'https://json.example.net/feed.json');

	it('reads items', () => {
		expect(feed).toMatchObject({
			format: 'json',
			title: 'JSON Journal',
			siteUrl: 'https://json.example.net/'
		});
		expect(feed.entries[0]).toMatchObject({
			guid: '1',
			title: 'First',
			author: 'Katherine Johnson',
			imageUrl: 'https://json.example.net/images/one.png',
			summary: 'Hello world'
		});
	});

	it('escapes content_text into paragraphs', () => {
		expect(feed.entries[1].guid).toBe('2');
		expect(feed.entries[1].content).toBe(
			'<p>Plain text</p><p>Second para with &lt;angle&gt; brackets</p>'
		);
	});
});

describe('parseFeed: RSS 1.0 (RDF)', () => {
	it('reads items that sit beside the channel', () => {
		const feed = parseFeed(fixture('rdf.xml'), 'https://rdf.example.com/index.rdf');
		expect(feed).toMatchObject({ format: 'rdf', title: 'RDF Site' });
		expect(feed.entries[0]).toMatchObject({
			url: 'https://rdf.example.com/a',
			title: 'RDF item',
			author: 'Old Timer'
		});
	});
});

describe('parseFeed: RSS guid handling', () => {
	it('never turns a non-URL guid into a link', () => {
		const feed = parseFeed(
			'<rss><channel><item><title>x</title><guid>post-7</guid></item></channel></rss>',
			'https://x.example/feed'
		);
		expect(feed.entries[0]).toMatchObject({ guid: 'post-7', url: null });
	});
});

describe('parseFeed: errors', () => {
	it.each([
		['<html><body>not a feed</body></html>', 'Not an RSS'],
		['{"items": "nope"}', 'no items'],
		['{broken', 'Not valid JSON']
	])('rejects %j', (body, message) => {
		expect(() => parseFeed(body, 'https://x.example/')).toThrow(FeedParseError);
		expect(() => parseFeed(body, 'https://x.example/')).toThrow(message);
	});

	it('caps entries at 50', () => {
		const items = Array.from({ length: 80 }, (_, i) => `<item><guid>${i}</guid></item>`).join('');
		const feed = parseFeed(
			`<rss><channel><title>t</title>${items}</channel></rss>`,
			'https://x.example/'
		);
		expect(feed.entries).toHaveLength(50);
	});
});

describe('stripTags', () => {
	it('drops tags, scripts and styles and decodes entities', () => {
		expect(stripTags('<p>a &amp; b</p><script>x()</script><style>p{}</style><p>c</p>')).toBe(
			'a & b c'
		);
	});
});

describe('discoverFeeds', () => {
	it('finds advertised feeds, resolving URLs and putting comment feeds last', () => {
		const html = `<head>
			<link rel="alternate" type="application/rss+xml" title="Comments Feed" href="/comments/feed/">
			<link rel="alternate" type="application/rss+xml" title="Main Feed" href="/feed/">
			<link rel="alternate" type="application/atom+xml" href="https://example.com/atom.xml">
			<link rel="alternate" type="application/json" href="/wp-json/oembed/1.0/embed?url=x">
			<link rel="alternate" hreflang="fr" href="/fr/">
			<link rel="stylesheet" href="/style.css">
		</head>`;
		expect(discoverFeeds(html, 'https://example.com/blog/').map((f) => f.url)).toEqual([
			'https://example.com/feed/',
			'https://example.com/atom.xml',
			'https://example.com/comments/feed/'
		]);
	});
});

describe('looksLikeFeed', () => {
	it.each([
		['<?xml version="1.0"?><rss version="2.0">', 'text/xml', true],
		['<feed xmlns="http://www.w3.org/2005/Atom">', null, true],
		['{"version": "https://jsonfeed.org/version/1.1"}', 'application/json', true],
		['<!doctype html><html>', 'text/html', false],
		['anything', 'application/rss+xml', true]
	])('%j (%s) → %s', (body, type, expected) => {
		expect(looksLikeFeed(body, type)).toBe(expected);
	});
});
