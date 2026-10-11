/**
 * Coming back to the app. Saved to the iPhone home screen, it runs as a web
 * app that iOS freezes in the background and resumes as it was, without
 * reloading, so the page would keep showing what it had when it was left.
 *
 * Coming back refreshes the page's data, but only when you're at the top of
 * it: partway into a story or down a list, the page is left exactly as it was
 * (Safari doesn't keep your place when content above you changes). It never
 * reloads; a new deploy is picked up when you next tap a link (+layout.svelte).
 */

/** Away for at least this long before coming back refreshes the page. */
export const RESUME_AFTER_MS = 30_000;

/** Scrolled further than this, you're reading: leave the page alone. */
export const AT_TOP_PX = 200;

export const awayLongEnough = (hiddenAt: number, now: number) => now - hiddenAt >= RESUME_AFTER_MS;

export const atTop = (scrollY: number) => scrollY <= AT_TOP_PX;
