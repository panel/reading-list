const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "today", "yesterday", "Tuesday", "Mar 3", "Mar 3, 2025". */
export function relativeDay(date: Date, now: Date = new Date()): string {
	const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
	if (days <= 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
	return date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' })
	});
}

/** The display name for a link's site: og:site_name, else the bare hostname. */
export function siteLabel(link: { siteName: string | null; url: string }): string {
	return link.siteName ?? new URL(link.url).hostname.replace(/^www\./, '');
}

export function hostname(url: string): string {
	return new URL(url).hostname.replace(/^www\./, '');
}

// Cool, low-chroma tones for links without an image, picked stably per site.
const TONES = ['#C8D6D3', '#D0DBE2', '#CCDCD4', '#D7D6E3', '#D4DECB', '#DDD6CC'];

export function toneFor(key: string): string {
	let hash = 0;
	for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return TONES[hash % TONES.length];
}

/** The link's title, or a readable "host/path" when the page had none. */
export function displayTitle(link: { title: string | null; url: string }): string {
	if (link.title) return link.title;
	const url = new URL(link.url);
	let path = url.pathname;
	try {
		path = decodeURIComponent(path);
	} catch {
		// keep the encoded path
	}
	return `${hostname(link.url)}${path === '/' ? '' : path}`;
}

/** Drop caps need a few lines of text to sit in; short notes look broken with one. */
export function wantsDropCap(text: string | null): boolean {
	return (text?.trim().length ?? 0) >= 90;
}

/**
 * Splits a search snippet (matches wrapped in \u0001…\u0002 by the server) into
 * plain-text segments, so highlights render as <mark> without any HTML parsing.
 */
export function highlightSegments(snippet: string): { text: string; match: boolean }[] {
	const segments: { text: string; match: boolean }[] = [];
	for (const part of snippet.split('\u0001')) {
		const [matched, rest] = part.includes('\u0002') ? part.split('\u0002', 2) : [null, part];
		if (matched) segments.push({ text: matched, match: true });
		if (rest) segments.push({ text: rest, match: false });
	}
	return segments;
}
