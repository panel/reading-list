import type { Action } from 'svelte/action';

export interface SwipeOptions {
	/** Called once the card has been swiped past the threshold: 1 = right, -1 = left. */
	onswipe: (direction: 1 | -1) => void;
	/** Reports the live drag offset (px) so the page can fade in hint labels. */
	ondrag?: (dx: number) => void;
	threshold?: number;
	disabled?: boolean;
}

const TAP_SLOP = 6;

/**
 * Horizontal swipe on a card: it follows the pointer with a slight tilt, and
 * either commits past `threshold` or springs back. Vertical scrolling still
 * works (touch-action: pan-y), and a drag never also counts as a click on a
 * link inside the card.
 */
export const swipe: Action<HTMLElement, SwipeOptions> = (node, initial) => {
	let options = initial;
	let startX = 0;
	let dx = 0;
	let pointerId: number | null = null;
	let dragged = false;
	const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

	node.style.touchAction = 'pan-y';

	const render = (animate: boolean) => {
		node.style.transition = animate ? 'transform 220ms cubic-bezier(.2,.8,.2,1)' : 'none';
		node.style.transform = dx ? `translateX(${dx}px) rotate(${reduceMotion ? 0 : dx / 30}deg)` : '';
		options.ondrag?.(dx);
	};

	const down = (e: PointerEvent) => {
		if (options.disabled || e.button !== 0) return;
		pointerId = e.pointerId;
		startX = e.clientX;
		dx = 0;
		dragged = false;
	};

	const move = (e: PointerEvent) => {
		if (e.pointerId !== pointerId) return;
		dx = e.clientX - startX;
		if (!dragged && Math.abs(dx) > TAP_SLOP) {
			dragged = true;
			node.setPointerCapture(e.pointerId);
		}
		if (dragged) render(false);
	};

	const up = (e: PointerEvent) => {
		if (e.pointerId !== pointerId) return;
		pointerId = null;
		if (!dragged) return;
		const threshold = options.threshold ?? 100;
		if (Math.abs(dx) >= threshold) {
			const direction = dx > 0 ? 1 : -1;
			dx = direction * (node.offsetWidth * 1.25);
			render(true);
			options.onswipe(direction);
		} else {
			dx = 0;
			render(true);
		}
	};

	const cancel = (e: PointerEvent) => {
		if (e.pointerId !== pointerId) return;
		pointerId = null;
		dx = 0;
		render(true);
	};

	// A drag ends with a click on whatever was under the pointer; swallow it.
	const click = (e: MouseEvent) => {
		if (dragged) {
			e.preventDefault();
			e.stopPropagation();
			dragged = false;
		}
	};

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', cancel);
	node.addEventListener('click', click, true);

	return {
		update(next) {
			options = next;
		},
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', cancel);
			node.removeEventListener('click', click, true);
		}
	};
};

/** Animates a card off-screen the same way a swipe does (for button presses and keys). */
export function flyOff(node: HTMLElement | undefined, direction: 1 | -1) {
	if (!node) return;
	const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
	node.style.transition = 'transform 220ms cubic-bezier(.2,.8,.2,1)';
	node.style.transform = `translateX(${direction * node.offsetWidth * 1.25}px) rotate(${reduceMotion ? 0 : direction * 8}deg)`;
}
