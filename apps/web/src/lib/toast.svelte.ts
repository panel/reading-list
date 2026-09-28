import type { QueueState } from '$lib/queue';

export interface Toast {
	message: string;
	/** When set, the toast offers Undo, which restores this link to this state. */
	undo?: { id: string; state: QueueState };
}

const DURATION_MS = 6000;

/** One app-wide toast, shown by the layout; it survives navigation. */
class ToastStore {
	current = $state<Toast | null>(null);
	/** Set by pages with a fixed action bar, so the toast sits above it. */
	raised = $state(false);
	#timer: ReturnType<typeof setTimeout> | undefined;

	show(toast: Toast) {
		clearTimeout(this.#timer);
		this.current = toast;
		this.#timer = setTimeout(() => this.clear(), DURATION_MS);
	}

	clear() {
		clearTimeout(this.#timer);
		this.current = null;
	}
}

export const toast = new ToastStore();
