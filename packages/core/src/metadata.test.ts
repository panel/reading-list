import { describe, expect, it } from 'vitest';
import { decodeEntities, extractMetadata, readHead } from './metadata';

const PAGE = 'https://www.example.com/blog/post?id=1';

describe('extractMetadata', () => {
	it('prefers Open Graph tags', () => {
		const html = `<!doctype html><html><head>
			<title>Fallback title | Example</title>
			<meta property="og:title" content="The Real Title">
			<meta property="og:description" content="A short summary.">
			<meta property="og:site_name" content="Example Blog">
			<meta property="og:image" content="/images/cover.jpg">
			<meta name="author" content="Ada Lovelace">
			<link rel="canonical" href="https://example.com/blog/post">
			<link rel="icon" href="/favicon-32.png" sizes="32x32">
			<link rel="apple-touch-icon" href="/apple-touch-icon.png">
		</head><body>ignored</body></html>`;
		expect(extractMetadata(html, PAGE)).toEqual({
			title: 'The Real Title',
			description: 'A short summary.',
			siteName: 'Example Blog',
			author: 'Ada Lovelace',
			imageUrl: 'https://www.example.com/images/cover.jpg',
			faviconUrl: 'https://www.example.com/apple-touch-icon.png',
			canonicalUrl: 'https://example.com/blog/post'
		});
	});

	it('falls back to Twitter cards, <title> and meta description', () => {
		const html = `<head>
			<title>  Plain
			title </title>
			<meta name="description" content="Meta description">
			<meta name="twitter:image" content="https://cdn.example.com/card.png">
		</head>`;
		const meta = extractMetadata(html, PAGE);
		expect(meta.title).toBe('Plain title');
		expect(meta.description).toBe('Meta description');
		expect(meta.imageUrl).toBe('https://cdn.example.com/card.png');
		expect(meta.faviconUrl).toBe('https://www.example.com/favicon.ico');
		expect(meta.siteName).toBeNull();
		expect(meta.canonicalUrl).toBeNull();
	});

	it('handles attribute order, single quotes, unquoted values and case', () => {
		const html = `<HEAD><META CONTENT='Quoted &amp; decoded' PROPERTY=og:title><meta content=Bare name=description></HEAD>`;
		const meta = extractMetadata(html, PAGE);
		expect(meta.title).toBe('Quoted & decoded');
		expect(meta.description).toBe('Bare');
	});

	it('decodes entities in titles', () => {
		const html = `<title>Don&#8217;t &quot;panic&quot; &mdash; it&#x27;s fine</title>`;
		expect(extractMetadata(html, PAGE).title).toBe('Don’t "panic" — it\'s fine');
	});

	it('ignores tags inside comments and scripts', () => {
		const html = `<head>
			<!-- <meta property="og:title" content="Commented out"> -->
			<script>document.write('<meta property="og:title" content="From script">')</script>
			<meta property="og:title" content="Real">
		</head>`;
		expect(extractMetadata(html, PAGE).title).toBe('Real');
	});

	it('uses the first of duplicate tags', () => {
		const html = `<meta property="og:image" content="/first.png"><meta property="og:image" content="/second.png">`;
		expect(extractMetadata(html, PAGE).imageUrl).toBe('https://www.example.com/first.png');
	});

	it('drops non-http image URLs and author profile URLs', () => {
		const html = `<meta property="og:image" content="data:image/png;base64,xyz">
			<meta property="article:author" content="https://facebook.com/someone">`;
		const meta = extractMetadata(html, PAGE);
		expect(meta.imageUrl).toBeNull();
		expect(meta.author).toBeNull();
	});

	it('truncates very long values', () => {
		const html = `<meta name="description" content="${'word '.repeat(400)}">`;
		const description = extractMetadata(html, PAGE).description!;
		expect(description.length).toBeLessThanOrEqual(1000);
		expect(description.endsWith('…')).toBe(true);
	});

	it('returns nulls for a page with no metadata', () => {
		const meta = extractMetadata('<html><body>hi</body></html>', PAGE);
		expect(meta.title).toBeNull();
		expect(meta.description).toBeNull();
	});
});

describe('decodeEntities', () => {
	it('leaves unknown entities alone', () => {
		expect(decodeEntities('a &bogus; b &#0; c')).toBe('a &bogus; b &#0; c');
	});
});

describe('readHead', () => {
	const stream = (chunks: string[]) => {
		const encoder = new TextEncoder();
		let pulled = 0;
		const s = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (pulled < chunks.length) controller.enqueue(encoder.encode(chunks[pulled++]));
				else controller.close();
			}
		});
		return { s, pulled: () => pulled };
	};

	it('stops after </head>', async () => {
		const { s, pulled } = stream(['<head><title>x</title>', '</head>', '<body>big', 'more body']);
		const html = await readHead(s);
		expect(html).toContain('</head>');
		expect(html).not.toContain('big');
		expect(pulled()).toBe(2);
	});

	it('stops at maxBytes', async () => {
		const { s } = stream(Array.from({ length: 10 }, () => 'x'.repeat(100)));
		expect((await readHead(s, 250)).length).toBe(300);
	});
});
