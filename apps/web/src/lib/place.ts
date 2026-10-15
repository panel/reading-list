/**
 * Keeping your place in a long read. The readers split the article into text
 * blocks (paragraphs, headings, list items); your place is the first block
 * still on screen, and your progress the share of the words before it. A block
 * index survives a different screen size, where a scroll offset wouldn't.
 */

/** What counts as a block, innermost first (as Read to me reads them), plus code. */
export const BLOCKS = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, dt, dd, pre';

/** The article's text blocks, innermost only (a list item, not its list); the whole article if none. */
export function articleBlocks(root: HTMLElement): HTMLElement[] {
	const found = [...root.querySelectorAll<HTMLElement>(BLOCKS)].filter(
		(el) => !el.querySelector(BLOCKS) && !el.parentElement?.closest('pre')
	);
	return found.length ? found : [root];
}

/** Read this far in before it counts as in progress (a glance at the top doesn't). */
export const STARTED = 0.05;

/** Save at most this often while scrolling, and once more when you stop. */
export const SAVE_EVERY_MS = 3000;

/** Where on screen a block has to reach to count as the one you're reading. */
export const TOP_PX = 24;

export const countWords = (text: string) => text.match(/\S+/g)?.length ?? 0;

/** The first block whose bottom is still below the top of the window. */
export function currentBlock(bottoms: number[], top = TOP_PX): number {
	const i = bottoms.findIndex((bottom) => bottom > top);
	return i === -1 ? Math.max(bottoms.length - 1, 0) : i;
}

/** The share of the article's words before this block. */
export function progressAt(words: number[], block: number): number {
	const total = words.reduce((n, w) => n + w, 0);
	if (!total) return 0;
	const before = words.slice(0, block).reduce((n, w) => n + w, 0);
	return Math.min(1, before / total);
}

/** Minutes left of a read this long, this far in (at least one). */
export const minutesLeft = (minutes: number, progress: number) =>
	Math.max(1, Math.round(minutes * (1 - progress)));

export const percent = (progress: number) => `${Math.round(progress * 100)}%`;
