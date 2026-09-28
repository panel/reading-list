/**
 * Whether a keydown should be left alone by single-key shortcuts: the user is
 * typing, or holding a modifier (so ⌘L, ⌘E etc. keep their browser meaning).
 */
export function ignoreShortcut(event: KeyboardEvent): boolean {
	if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return true;
	const target = event.target as HTMLElement | null;
	if (!target) return false;
	return (
		target.isContentEditable ||
		['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
		Boolean(target.closest('[role="dialog"]'))
	);
}
