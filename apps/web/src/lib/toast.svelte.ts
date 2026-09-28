import type { QueueState } from '$lib/queue';

/** Undo is a form POST: an action URL plus the fields that reverse the change. */
export interface Undo {
	action: string;
	fields: Record<string, string>;
}

/** Undo for Finished / Later: restore the link's exact previous queue state. */
export const undoQueueChange = (linkUrl: string, state: QueueState): Undo => ({
	action: `${linkUrl}?/restore`,
	fields: {
		status: state.status,
		queuedAt: String(state.queuedAt),
		readAt: state.readAt === null ? '' : String(state.readAt)
	}
});

export interface Toast {
	message: string;
	/** When set, the toast offers Undo. */
	undo?: Undo;
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
