import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { articleFromHtml, extractArticle, parseHtml } from './article';

const fixture = (name: string) =>
	readFileSync(new URL(`./fixtures/articles/${name}`, import.meta.url), 'utf8');

describe('extractArticle', () => {
	const blog = extractArticle(fixture('blog.html'), 'https://blog.example.com/posts/caching')!;

	it('keeps the post and drops navigation, comments, share bars and sidebars', () => {
		expect(blog.text).toContain('two hard things');
		expect(blog.text).toContain('Last paragraph with a bold ending — and an entity.');
		for (const junk of [
			'Home',
			'cookies',
			'12 comments',
			'Share on',
			'Related',
			'newsletter',
			'©'
		]) {
			expect(blog.text).not.toContain(junk);
		}
		expect(blog.text).not.toContain('not content');
		expect(blog.words).toBeGreaterThan(150);
	});

	it('keeps structure: headings, figures, quotes, code and lists', () => {
		expect(blog.html).toContain('<h2>Invalidation</h2>');
		expect(blog.html).toContain('<blockquote><p>There are only two hard things');
		expect(blog.html).toContain(
			'<pre><code>const value = cache.get(key) ?? compute(key);</code></pre>'
		);
		expect(blog.html).toContain('<li>Event-based purges &amp; tags</li>');
		expect(blog.html).toContain('<figcaption>How entries expire.</figcaption>');
	});

	it('resolves links and lazy images against the page’s <base>', () => {
		expect(blog.html).toContain('href="https://blog.example.com/glossary#cache"');
		expect(blog.html).toContain(
			'<img src="https://blog.example.com/posts/img/diagram.png" alt="A diagram of a cache">'
		);
		expect(blog.html).not.toContain('data:image');
	});

	it('only emits a small set of tags, with no scripts, styles or classes', () => {
		expect(blog.html).not.toMatch(/<(script|style|nav|header|footer|span|article)\b/);
		expect(blog.html).not.toMatch(/\sclass=|\sid=|\sstyle=/);
	});

	it('finds the story in a div-heavy news layout and skips hidden ads and promos', () => {
		const news = extractArticle(fixture('news.html'), 'https://news.example.com/story')!;
		expect(news.text.match(/quick brown fox/g)).toHaveLength(4);
		expect(news.text).not.toContain('Advertisement');
		expect(news.text).not.toContain('Most read');
		expect(news.text).not.toContain('Sports');
		expect(news.text).not.toContain('Read more');
	});

	it('returns little or nothing for an app shell', () => {
		const shell = extractArticle(fixture('nav-only.html'), 'https://app.example.com/');
		expect(shell?.words ?? 0).toBeLessThan(10);
	});

	it('extracts a big page quickly', () => {
		const huge = fixture('blog.html').replace(
			'</article>',
			`${'<div class="x"><p>filler text, more filler, and more.</p></div>'.repeat(4000)}</article>`
		);
		const start = performance.now();
		extractArticle(huge, 'https://blog.example.com/');
		expect(performance.now() - start).toBeLessThan(500);
	});
});

describe('parseHtml', () => {
	it('closes paragraphs and list items the way browsers do', () => {
		const root = parseHtml('<p>one<p>two<ul><li>a<li>b</ul>');
		const tags = root.children.map((c) => (typeof c === 'string' ? c : c.tag));
		expect(tags).toEqual(['p', 'p', 'ul']);
	});

	it('skips raw text elements without parsing their contents', () => {
		const root = parseHtml('<script>if (a < b) document.write("<p>x</p>")</script><p>ok</p>');
		expect(root.children).toHaveLength(1);
	});
});

describe('articleFromHtml', () => {
	it('counts words in HTML that is already an article', () => {
		expect(articleFromHtml('<p>Hello <b>big</b> world.</p><p>Again&nbsp;here</p>')).toMatchObject({
			text: 'Hello big world.\n\nAgain here',
			words: 5
		});
	});
});
