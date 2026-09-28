import { describe, expect, it } from 'vitest';
import { readingMinutes, sanitizeEntryHtml, withoutOpeningImage } from './sanitize';

const BASE = 'https://blog.example.com/posts/one';
const clean = (html: string) => sanitizeEntryHtml(html, BASE);

describe('sanitizeEntryHtml', () => {
	it('keeps ordinary article markup', () => {
		expect(clean('<h2>Title</h2><p>Some <em>text</em> and <code>code</code>.</p>')).toBe(
			'<h2>Title</h2><p>Some <em>text</em> and <code>code</code>.</p>'
		);
	});

	it('removes scripts, styles, iframes and their contents', () => {
		const out = clean(
			'<p>a</p><script>alert(1)</script><style>p{color:red}</style><iframe src="https://evil.test"></iframe><p>b</p>'
		);
		expect(out).toBe('<p>a</p><p>b</p>');
	});

	it('strips event handlers, inline styles and classes', () => {
		const out = clean(
			'<p onclick="x()" style="color:red" class="c" id="i">hi</p><img src="/a.png" onerror="x()">'
		);
		expect(out).not.toMatch(/onclick|onerror|style=|class=|id=/);
		expect(out).toContain('<p>hi</p>');
	});

	it('neutralizes javascript: and data: URLs', () => {
		const out = clean(
			'<a href="javascript:alert(1)">x</a><img src="data:image/svg+xml;base64,AAA">'
		);
		expect(out).not.toMatch(/javascript:|data:/);
	});

	it('resolves relative links, opens them in a new tab, and lazy-loads images', () => {
		const out = clean('<a href="/two">next</a><img src="img/a.png" alt="A">');
		expect(out).toContain(
			'<a href="https://blog.example.com/two" target="_blank" rel="noopener noreferrer nofollow">next</a>'
		);
		expect(out).toContain('src="https://blog.example.com/posts/img/a.png"');
		expect(out).toContain('loading="lazy"');
		expect(out).toContain('referrerpolicy="no-referrer"');
		expect(out).toContain('alt="A"');
	});

	it('drops unknown tags but keeps their text', () => {
		expect(clean('<custom-el>kept</custom-el> <font color="red">too</font>')).toBe('kept too');
	});

	it('removes comments and forms', () => {
		expect(clean('<!-- secret --><form><input name="x"></form><p>ok</p>')).toBe('<p>ok</p>');
	});
});

describe('readingMinutes', () => {
	it('is at least one minute and scales with words', () => {
		expect(readingMinutes('short')).toBe(1);
		expect(readingMinutes('word '.repeat(1150))).toBe(5);
	});
});

describe('withoutOpeningImage', () => {
	const img = '<img src="https://x.test/cover.jpg" loading="lazy">';
	it('drops the lead image when the post opens with it, with an emptied wrapper', () => {
		expect(
			withoutOpeningImage(`<figure>${img}</figure><p>Text</p>`, 'https://x.test/cover.jpg')
		).toBe('<p>Text</p>');
		expect(withoutOpeningImage(`<p>Intro</p>${img}<p>More</p>`, 'https://x.test/cover.jpg')).toBe(
			'<p>Intro</p><p>More</p>'
		);
	});

	it('keeps it when it appears later in the post, or is a different image', () => {
		const later = `<p>1</p><p>2</p>${img}`;
		expect(withoutOpeningImage(later, 'https://x.test/cover.jpg')).toBe(later);
		expect(withoutOpeningImage(`${img}<p>x</p>`, 'https://x.test/other.jpg')).toContain('<img');
		expect(withoutOpeningImage(`${img}`, null)).toBe(img);
	});
});
