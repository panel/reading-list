import { describe, expect, it } from 'vitest';
import { fetchPageMetadata } from './metadata';

const respond =
	(body: string, init: ResponseInit & { url?: string } = {}): typeof fetch =>
	async () => {
		const response = new Response(body, {
			headers: { 'content-type': 'text/html; charset=utf-8' },
			...init
		});
		if (init.url) Object.defineProperty(response, 'url', { value: init.url });
		return response;
	};

describe('fetchPageMetadata', () => {
	it('extracts metadata and reports the final URL after redirects', async () => {
		const page = await fetchPageMetadata(
			'https://t.co/abc',
			respond('<head><meta property="og:title" content="Hello"></head>', {
				url: 'https://example.com/hello'
			})
		);
		expect(page.finalUrl).toBe('https://example.com/hello');
		expect(page.metadata?.title).toBe('Hello');
	});

	it('returns null metadata for non-HTML responses', async () => {
		const page = await fetchPageMetadata(
			'https://example.com/file.pdf',
			respond('%PDF', { headers: { 'content-type': 'application/pdf' } })
		);
		expect(page.metadata).toBeNull();
	});

	it('returns null metadata for error responses', async () => {
		const page = await fetchPageMetadata('https://example.com/x', respond('nope', { status: 403 }));
		expect(page.metadata).toBeNull();
	});

	it('never throws when the fetch fails', async () => {
		const page = await fetchPageMetadata('https://example.com/x', async () => {
			throw new TypeError('network down');
		});
		expect(page).toEqual({ finalUrl: 'https://example.com/x', metadata: null });
	});
});
