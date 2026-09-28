// xss is CommonJS: Vite's SSR build only exposes its default export.
import xss from 'xss';

const { FilterXSS, escapeAttrValue } = xss as unknown as typeof import('xss');

/** Tags a feed post may keep; everything else is dropped (text inside is kept). */
const ALLOWED: Record<string, string[]> = {
	a: ['href', 'title'],
	abbr: ['title'],
	b: [],
	blockquote: ['cite'],
	br: [],
	caption: [],
	cite: [],
	code: [],
	dd: [],
	del: [],
	details: [],
	div: [],
	dl: [],
	dt: [],
	em: [],
	figcaption: [],
	figure: [],
	h1: [],
	h2: [],
	h3: [],
	h4: [],
	h5: [],
	h6: [],
	hr: [],
	i: [],
	img: ['src', 'alt', 'title', 'width', 'height'],
	ins: [],
	kbd: [],
	li: [],
	mark: [],
	ol: ['start'],
	p: [],
	pre: [],
	q: [],
	s: [],
	samp: [],
	small: [],
	span: [],
	strong: [],
	sub: [],
	summary: [],
	sup: [],
	table: [],
	tbody: [],
	td: ['colspan', 'rowspan'],
	tfoot: [],
	th: ['colspan', 'rowspan', 'scope'],
	thead: [],
	time: ['datetime'],
	tr: [],
	u: [],
	ul: []
};

function safeUrl(value: string, base: string | null, schemes: string[]): string | null {
	try {
		const url = new URL(value.trim(), base ?? undefined);
		return schemes.includes(url.protocol) ? url.toString() : null;
	} catch {
		return null;
	}
}

/**
 * Sanitizes a feed post's HTML for rendering on our origin: an allowlist of
 * tags and attributes, http(s) links and images only (resolved against the
 * post's URL), links open in a new tab, images lazy-load without a referrer.
 * Scripts, styles, iframes, forms and event handlers never survive.
 */
export function sanitizeEntryHtml(html: string, baseUrl: string | null): string {
	const filter = new FilterXSS({
		whiteList: ALLOWED,
		stripIgnoreTag: true,
		stripIgnoreTagBody: [
			'script',
			'style',
			'iframe',
			'noscript',
			'svg',
			'math',
			'form',
			'object',
			'embed',
			'template'
		],
		allowCommentTag: false,
		css: false,
		onTagAttr(tag, name, value) {
			if (tag === 'a' && name === 'href') {
				const url = safeUrl(value, baseUrl, ['http:', 'https:', 'mailto:']);
				return url
					? `href="${escapeAttrValue(url)}" target="_blank" rel="noopener noreferrer nofollow"`
					: '';
			}
			if (tag === 'img' && name === 'src') {
				const url = safeUrl(value, baseUrl, ['http:', 'https:']);
				return url
					? `src="${escapeAttrValue(url)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"`
					: '';
			}
			if (tag === 'blockquote' && name === 'cite') {
				const url = safeUrl(value, baseUrl, ['http:', 'https:']);
				return url ? `cite="${escapeAttrValue(url)}"` : '';
			}
			// Other allowed attributes fall through to the default (escaped) handling.
			return undefined;
		}
	});
	return filter.process(html).trim();
}

/** Rough reading time for a post, in minutes (230 words a minute). */
export function readingMinutes(text: string): number {
	const words = text.split(/\s+/).filter(Boolean).length;
	return Math.max(1, Math.round(words / 230));
}

/**
 * The reader shows a post's lead image above the headline. When the post
 * itself opens with that same image (before its second paragraph ends), drop
 * it from the body so it isn't shown twice.
 */
export function withoutOpeningImage(html: string, imageUrl: string | null): string {
	if (!imageUrl) return html;
	let path: string;
	try {
		path = new URL(imageUrl).pathname;
	} catch {
		return html;
	}
	const img = [...html.matchAll(/<img\b[^>]*>/gi)].find((m) => m[0].includes(path));
	if (!img || img.index === undefined) return html;
	const paragraphsBefore = html.slice(0, img.index).split('</p>').length - 1;
	if (paragraphsBefore > 1) return html;
	return (html.slice(0, img.index) + html.slice(img.index + img[0].length))
		.replace(/<(figure|p)>\s*<\/\1>/g, '')
		.trim();
}
