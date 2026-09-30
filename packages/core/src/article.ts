/**
 * Pulls the readable article out of a web page: a small, forgiving HTML parser
 * plus Readability-style scoring (paragraph text flows up to its containers,
 * the best container wins, link-heavy clutter is dropped). Pure TypeScript, so
 * it runs the same in Workers, the dev server and unit tests.
 *
 * The HTML it returns uses a small set of tags and attributes with absolute
 * URLs, but it is not a security boundary: sanitize it again before rendering.
 */
import { decodeEntities } from './metadata';

export interface Article {
	html: string;
	text: string;
	words: number;
}

type Child = Element | string;
interface Element {
	tag: string;
	attrs: Record<string, string>;
	children: Child[];
	parent: Element | null;
	// Filled in by measure(): text length, text length inside links, has an image.
	len?: number;
	linkLen?: number;
	img?: boolean;
}

/** Pages bigger than this are cut off; the article is almost always near the top. */
export const MAX_PAGE_CHARS = 1_500_000;
/** Stored copies are capped like feed posts. */
const MAX_ARTICLE_CHARS = 400_000;

const VOID = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr'
]);
/** Their contents are raw text (or irrelevant), skipped without parsing. */
const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'template', 'xmp', 'svg']);
const BLOCK = new Set([
	'address',
	'article',
	'aside',
	'blockquote',
	'details',
	'div',
	'dl',
	'fieldset',
	'figcaption',
	'figure',
	'footer',
	'form',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'header',
	'hr',
	'main',
	'nav',
	'ol',
	'p',
	'pre',
	'section',
	'table',
	'ul'
]);
/** Never part of an article. */
const DROP = new Set([
	'aside',
	'button',
	'canvas',
	'dialog',
	'embed',
	'footer',
	'form',
	'header',
	'iframe',
	'input',
	'link',
	'meta',
	'nav',
	'object',
	'select',
	'base'
]);

const UNLIKELY =
	/-ad-|ad-break|agegate|banner|breadcrumb|combx|comment|community|cookie|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|modal|newsletter|pager|pagination|popup|promo|related|remark|replies|rss|share|shoutbox|sidebar|skyscraper|social|sponsor|subscribe|supplemental|yom-remote/i;
const MAYBE = /and|article|body|column|content|main|shadow/i;
const POSITIVE = /article|body|content|entry|h-entry|hentry|main|page|post|story|text|blog/i;
const NEGATIVE =
	/-ad-|banner|combx|comment|com-|contact|foot|footnote|gdpr|hidden|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget/i;

// ——— Parsing ————————————————————————————————————————————————————————

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const TAG_NAME = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/y;
const NO_ATTRS: Record<string, string> = Object.freeze({}) as Record<string, string>;

function parseAttrs(source: string): Record<string, string> {
	if (!source.trim() || source.trim() === '/') return NO_ATTRS;
	const attrs: Record<string, string> = {};
	for (const m of source.matchAll(ATTR)) {
		const name = m[1].toLowerCase();
		if (name in attrs) continue;
		const value = m[2] ?? m[3] ?? m[4] ?? '';
		attrs[name] = value.includes('&') ? decodeEntities(value) : value;
	}
	return attrs;
}

/** Where a tag's closing '>' is, skipping any inside quoted attribute values. */
function tagEnd(html: string, from: number): number {
	const end = html.indexOf('>', from);
	if (end === -1) return -1;
	const segment = html.slice(from, end);
	if (!segment.includes('"') && !segment.includes("'")) return end;
	let quote = '';
	for (let i = from; i < html.length; i++) {
		const ch = html[i];
		if (quote) {
			if (ch === quote) quote = '';
		} else if (ch === '"' || ch === "'") quote = ch;
		else if (ch === '>') return i;
	}
	return -1;
}

/** Builds a loose tree; unclosed and misnested tags are closed where it's reasonable. */
export function parseHtml(html: string): Element {
	const root: Element = { tag: '#root', attrs: {}, children: [], parent: null };
	let current = root;
	const open = (tag: string) => {
		// A new block closes an open paragraph; list items and cells close their siblings.
		if (BLOCK.has(tag) && current.tag === 'p') current = current.parent!;
		if (tag === 'li' && current.tag === 'li') current = current.parent!;
		if ((tag === 'dt' || tag === 'dd') && (current.tag === 'dt' || current.tag === 'dd'))
			current = current.parent!;
		if ((tag === 'td' || tag === 'th') && (current.tag === 'td' || current.tag === 'th'))
			current = current.parent!;
		if (tag === 'tr') {
			if (current.tag === 'td' || current.tag === 'th') current = current.parent!;
			if (current.tag === 'tr') current = current.parent!;
		}
	};
	const lower = html.toLowerCase();
	let pos = 0;
	while (pos < html.length) {
		const lt = html.indexOf('<', pos);
		if (lt === -1) {
			current.children.push(html.slice(pos));
			break;
		}
		if (lt > pos) current.children.push(html.slice(pos, lt));
		if (html.startsWith('<!--', lt)) {
			const end = html.indexOf('-->', lt + 4);
			pos = end === -1 ? html.length : end + 3;
			continue;
		}
		if (html[lt + 1] === '!' || html[lt + 1] === '?') {
			const end = html.indexOf('>', lt);
			pos = end === -1 ? html.length : end + 1;
			continue;
		}
		TAG_NAME.lastIndex = lt;
		const m = TAG_NAME.exec(html);
		const end = m ? tagEnd(html, TAG_NAME.lastIndex) : -1;
		if (!m || end === -1) {
			current.children.push('<');
			pos = lt + 1;
			continue;
		}
		const attrSource = html.slice(TAG_NAME.lastIndex, end);
		pos = end + 1;
		const closing = m[1] === '/';
		const tag = m[2].toLowerCase();
		if (closing) {
			for (let el: Element | null = current; el && el !== root; el = el.parent) {
				if (el.tag === tag) {
					current = el.parent!;
					break;
				}
			}
			continue;
		}
		if (RAW.has(tag)) {
			const end = lower.indexOf(`</${tag}`, pos);
			pos = end === -1 ? html.length : html.indexOf('>', end) + 1 || html.length;
			continue;
		}
		open(tag);
		const el: Element = { tag, attrs: parseAttrs(attrSource), children: [], parent: current };
		current.children.push(el);
		if (!VOID.has(tag) && !attrSource.trimEnd().endsWith('/')) current = el;
	}
	return root;
}

// ——— Measuring ——————————————————————————————————————————————————————

const isElement = (c: Child): c is Element => typeof c !== 'string';

function textOf(el: Element): string {
	let out = '';
	for (const c of el.children) out += isElement(c) ? textOf(c) : c;
	return out;
}

const squash = (text: string) => decodeEntities(text).replace(/\s+/g, ' ').trim();

/**
 * Sets each element's text length, linked text length and whether it holds an
 * image, from its children's. Called bottom-up once, so every later check is
 * O(1) instead of re-walking subtrees.
 */
function sumUp(el: Element): void {
	let len = 0;
	let linkLen = 0;
	let img = el.tag === 'img';
	for (const c of el.children) {
		if (!isElement(c)) {
			len += c.trim().length;
			continue;
		}
		len += c.len!;
		linkLen += c.linkLen!;
		img ||= c.img!;
	}
	el.len = len;
	el.linkLen = el.tag === 'a' ? len : linkLen;
	el.img = img;
}

function measure(el: Element): void {
	for (const c of el.children) if (isElement(c)) measure(c);
	sumUp(el);
}

const linkDensity = (el: Element) => (el.len ? el.linkLen! / el.len : 0);

/** Every element under `root`, in document order, without recursion. */
function allElements(root: Element): Element[] {
	const out: Element[] = [];
	const stack: Element[] = [root];
	while (stack.length) {
		const el = stack.pop()!;
		if (el !== root) out.push(el);
		for (let i = el.children.length - 1; i >= 0; i--) {
			const c = el.children[i];
			if (isElement(c)) stack.push(c);
		}
	}
	return out;
}

const classAndId = (el: Element) => `${el.attrs.class ?? ''} ${el.attrs.id ?? ''}`;

function classWeight(el: Element): number {
	const names = classAndId(el);
	if (!names.trim()) return 0;
	return (POSITIVE.test(names) ? 25 : 0) - (NEGATIVE.test(names) ? 25 : 0);
}

function isHidden(el: Element): boolean {
	return (
		'hidden' in el.attrs ||
		el.attrs['aria-hidden'] === 'true' ||
		/display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.attrs.style ?? '')
	);
}

// ——— Cleaning and scoring ———————————————————————————————————————————

/** Removes elements that are never article content, before scoring. */
function prune(el: Element): void {
	el.children = el.children.filter((c) => {
		if (!isElement(c)) return true;
		if (
			DROP.has(c.tag) ||
			isHidden(c) ||
			c.attrs.role === 'navigation' ||
			c.attrs.role === 'dialog'
		)
			return false;
		const names = classAndId(c);
		if (
			c.tag !== 'body' &&
			c.tag !== 'article' &&
			c.tag !== 'main' &&
			UNLIKELY.test(names) &&
			!MAYBE.test(names)
		)
			return false;
		prune(c);
		return true;
	});
}

const hasBlockChild = (el: Element) => el.children.some((c) => isElement(c) && BLOCK.has(c.tag));

function baseScore(el: Element): number {
	switch (el.tag) {
		case 'div':
		case 'article':
		case 'main':
		case 'section':
			return 5 + classWeight(el);
		case 'pre':
		case 'td':
		case 'blockquote':
			return 3 + classWeight(el);
		case 'ol':
		case 'ul':
		case 'dl':
		case 'dd':
		case 'dt':
		case 'li':
			return -3 + classWeight(el);
		case 'h1':
		case 'h2':
		case 'h3':
		case 'h4':
		case 'h5':
		case 'h6':
		case 'th':
			return -5 + classWeight(el);
		default:
			return classWeight(el);
	}
}

function pickContent(body: Element): Element | null {
	const scores = new Map<Element, number>();
	const add = (el: Element | null, points: number) => {
		if (!el || el.tag === '#root' || el.tag === 'html' || el.tag === 'body') return;
		scores.set(el, (scores.get(el) ?? baseScore(el)) + points);
	};

	for (const el of allElements(body)) {
		// Paragraphs, and divs that act as one (text with no block children).
		const paragraphLike =
			el.tag === 'p' ||
			el.tag === 'pre' ||
			el.tag === 'td' ||
			(el.tag === 'div' && !hasBlockChild(el));
		if (!paragraphLike) continue;
		const text = squash(textOf(el));
		if (text.length < 25) continue;
		const points = 1 + text.split(/[,，]/).length - 1 + Math.min(Math.floor(text.length / 100), 3);
		let ancestor = el.parent;
		for (let level = 0; ancestor && level < 5; level++, ancestor = ancestor.parent) {
			add(ancestor, level === 0 ? points : level === 1 ? points / 2 : points / (level * 3));
		}
	}

	let best: Element | null = null;
	let bestScore = -Infinity;
	for (const [el, score] of scores) {
		const adjusted = score * (1 - linkDensity(el));
		scores.set(el, adjusted);
		if (adjusted > bestScore) {
			best = el;
			bestScore = adjusted;
		}
	}
	if (!best) return null;

	// A parent that holds the best block plus other good ones (e.g. a post split
	// into several sections) is the better pick.
	const parent = best.parent;
	if (!parent || parent.tag === 'body' || parent.tag === '#root') return best;
	const keep: Child[] = [];
	const threshold = Math.max(10, bestScore * 0.2);
	for (const sibling of parent.children) {
		if (!isElement(sibling)) continue;
		if (sibling === best) {
			keep.push(sibling);
			continue;
		}
		if ((scores.get(sibling) ?? -Infinity) >= threshold) {
			keep.push(sibling);
			continue;
		}
		if (sibling.tag !== 'p') continue;
		const density = linkDensity(sibling);
		const length = sibling.len!;
		if (
			(length > 80 && density < 0.25) ||
			(length > 0 && density === 0 && /\.( |$)/.test(squash(textOf(sibling))))
		)
			keep.push(sibling);
	}
	return { tag: 'div', attrs: {}, children: keep, parent: null };
}

const TIDIED = new Set(['div', 'section', 'ul', 'ol', 'table', 'p']);

/** After picking: drops link lists, empty wrappers and other leftovers. */
function tidy(el: Element): void {
	el.children = el.children.filter((c) => {
		if (!isElement(c)) return true;
		tidy(c);
		if (c.tag === 'img' || c.tag === 'br' || c.tag === 'hr') return true;
		if (!c.len && !c.img) return false;
		if (TIDIED.has(c.tag)) {
			if (linkDensity(c) > 0.5 && c.len! < 400) return false;
			if (classWeight(c) < 0 && c.len! < 200) return false;
		}
		return true;
	});
	sumUp(el);
}

// ——— Output —————————————————————————————————————————————————————————

const KEEP = new Set([
	'a',
	'abbr',
	'b',
	'blockquote',
	'br',
	'caption',
	'cite',
	'code',
	'dd',
	'del',
	'div',
	'dl',
	'dt',
	'em',
	'figcaption',
	'figure',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'i',
	'img',
	'ins',
	'kbd',
	'li',
	'mark',
	'ol',
	'p',
	'pre',
	'q',
	's',
	'small',
	'strong',
	'sub',
	'sup',
	'table',
	'tbody',
	'td',
	'tfoot',
	'th',
	'thead',
	'tr',
	'u',
	'ul'
]);

const escapeText = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

function absolute(value: string | undefined, base: string): string | null {
	if (!value?.trim()) return null;
	try {
		const url = new URL(value.trim(), base);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
}

/** The first candidate from a srcset ("a.jpg 1x, b.jpg 2x" → the largest). */
function fromSrcset(srcset: string | undefined): string | undefined {
	const parts = srcset
		?.split(',')
		.map((p) => p.trim().split(/\s+/)[0])
		.filter(Boolean);
	return parts?.length ? parts[parts.length - 1] : undefined;
}

function serialize(el: Element, base: string, out: string[]): void {
	for (const c of el.children) {
		if (!isElement(c)) {
			// Text is re-escaped after decoding so entities come out consistent.
			out.push(escapeText(decodeEntities(c)));
			continue;
		}
		const tag = c.tag === 'h1' ? 'h2' : c.tag;
		if (!KEEP.has(tag)) {
			serialize(c, base, out);
			continue;
		}
		let attrs = '';
		if (tag === 'a') {
			const href = absolute(c.attrs.href, base);
			if (!href) {
				serialize(c, base, out);
				continue;
			}
			attrs = ` href="${escapeAttr(href)}"`;
		} else if (tag === 'img') {
			// Lazy-loading scripts keep the real image in a data attribute.
			const src = absolute(
				c.attrs['data-src'] ??
					c.attrs['data-original'] ??
					c.attrs['data-lazy-src'] ??
					fromSrcset(c.attrs['data-srcset'] ?? c.attrs.srcset) ??
					c.attrs.src,
				base
			);
			if (!src || src.startsWith('data:')) continue;
			attrs = ` src="${escapeAttr(src)}"`;
			if (c.attrs.alt) attrs += ` alt="${escapeAttr(c.attrs.alt)}"`;
			out.push(`<img${attrs}>`);
			continue;
		} else if ((tag === 'td' || tag === 'th') && c.attrs.colspan) {
			attrs = ` colspan="${escapeAttr(c.attrs.colspan)}"`;
		}
		if (VOID.has(tag)) {
			out.push(`<${tag}>`);
			continue;
		}
		out.push(`<${tag}${attrs}>`);
		serialize(c, base, out);
		out.push(`</${tag}>`);
	}
}

function plainText(el: Element): string {
	const parts: string[] = [];
	const walk = (e: Element) => {
		for (const c of e.children) {
			if (!isElement(c)) parts.push(c);
			else {
				const block = BLOCK.has(c.tag) || c.tag === 'li' || c.tag === 'br' || c.tag === 'tr';
				if (block) parts.push('\n');
				walk(c);
				if (block) parts.push('\n');
			}
		}
	};
	walk(el);
	return decodeEntities(parts.join(''))
		.replace(/[ \t\r\f\v ]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

const countWords = (text: string) => text.match(/\S+/g)?.length ?? 0;

/**
 * The part of the page worth parsing. A page with exactly one <article>, or
 * else a <main>, keeps its article there; parsing only that skips the menus,
 * teasers and footers around it, which are most of the markup (and CPU) on
 * news sites. Anything else is parsed whole.
 */
function focus(page: string): string {
	const lower = page.toLowerCase();
	for (const tag of ['article', 'main']) {
		const start = lower.indexOf(`<${tag}`);
		if (start === -1 || !/[\s>]/.test(lower[start + tag.length + 1] ?? '')) continue;
		if (tag === 'article' && lower.indexOf(`<${tag}`, start + 1) !== -1) continue;
		const end = lower.lastIndexOf(`</${tag}>`);
		if (end > start) return page.slice(start, end + tag.length + 3);
	}
	return page;
}

/**
 * The article in a page, or null if none could be found. `baseUrl` resolves
 * relative links and images (the page's final URL after redirects).
 */
export function extractArticle(page: string, baseUrl: string): Article | null {
	if (page.length > MAX_PAGE_CHARS) page = page.slice(0, MAX_PAGE_CHARS);
	const baseHref = page.match(/<base\s[^>]*href\s*=\s*["']?([^"'\s>]+)/i)?.[1];
	const base = absolute(baseHref && decodeEntities(baseHref), baseUrl) ?? baseUrl;
	const tree = parseHtml(focus(page));
	const body = allElements(tree).find((e) => e.tag === 'body') ?? tree;
	prune(body);
	measure(body);
	const content = pickContent(body);
	if (!content) return null;
	tidy(content);
	const out: string[] = [];
	serialize(content, base, out);
	let html = out.join('').trim();
	if (html.length > MAX_ARTICLE_CHARS) html = html.slice(0, MAX_ARTICLE_CHARS);
	const text = plainText(content);
	return { html, text, words: countWords(text) };
}

/** Plain text and word count for HTML that is already an article (a feed post). */
export function articleFromHtml(html: string): Article {
	const tree = parseHtml(html);
	const text = plainText(tree);
	return { html, text, words: countWords(text) };
}
