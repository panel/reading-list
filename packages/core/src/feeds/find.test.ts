import { describe, expect, it } from 'vitest';
import { findFeed, FeedNotFoundError } from './refresh';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title><link>https://site.test/</link>
<item><title>Post</title><link>https://site.test/p</link><guid>1</guid></item></channel></rss>`;

/** A fake fetch serving a small site: path → [status, content-type, body]. */
function site(pages: Record<string, [number, string, string]>): typeof fetch {
	return (async (input: RequestInfo | URL) => {
		const url = new URL(String(input));
		const page = pages[url.pathname];
		const response = page
			? new Response(page[2], { status: page[0], headers: { 'content-type': page[1] } })
			: new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
		Object.defineProperty(response, 'url', { value: url.toString() });
		return response;
	}) as typeof fetch;
}

describe('findFeed', () => {
	it('accepts a feed URL directly', async () => {
		const found = await findFeed(
			'https://site.test/feed.xml',
			site({ '/feed.xml': [200, 'application/rss+xml', RSS] })
		);
		expect(found.url).toBe('https://site.test/feed.xml');
		expect(found.parsed.title).toBe('Blog');
	});

	it('follows a page’s advertised feed', async () => {
		const found = await findFeed(
			'site.test',
			site({
				'/': [
					200,
					'text/html',
					'<head><link rel="alternate" type="application/rss+xml" href="/posts.rss"></head>'
				],
				'/posts.rss': [200, 'text/xml', RSS]
			})
		);
		expect(found.url).toBe('https://site.test/posts.rss');
	});

	it('tries conventional paths when nothing is advertised', async () => {
		const found = await findFeed(
			'https://site.test/about',
			site({
				'/about': [200, 'text/html', '<head></head>'],
				'/index.xml': [200, 'application/xml', RSS]
			})
		);
		expect(found.url).toBe('https://site.test/index.xml');
	});

	it('skips an advertised feed that is broken and keeps looking', async () => {
		const found = await findFeed(
			'https://site.test/',
			site({
				'/': [
					200,
					'text/html',
					'<link rel="alternate" type="application/atom+xml" href="/gone.atom">'
				],
				'/feed': [200, 'application/rss+xml', RSS]
			})
		);
		expect(found.url).toBe('https://site.test/feed');
	});

	it('reports when there is no feed', async () => {
		await expect(
			findFeed('https://site.test/', site({ '/': [200, 'text/html', '<p>hi</p>'] }))
		).rejects.toThrow(FeedNotFoundError);
	});

	it('falls back to http when no scheme was given and https fails', async () => {
		const serveHttpOnly = site({ '/feed.xml': [200, 'application/rss+xml', RSS] });
		const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).startsWith('https:')) throw new TypeError('fetch failed');
			return serveHttpOnly(input, init);
		}) as typeof fetch;
		const found = await findFeed('site.test/feed.xml', fetchFn);
		expect(found.url).toBe('http://site.test/feed.xml');
		await expect(findFeed('https://site.test/feed.xml', fetchFn)).rejects.toThrow('Couldn’t reach');
	});

	it('reports when the site is unreachable', async () => {
		await expect(
			findFeed('https://down.test/', (async () => {
				throw new TypeError('fetch failed');
			}) as typeof fetch)
		).rejects.toThrow('Couldn’t reach down.test');
	});
});
