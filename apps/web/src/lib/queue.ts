/** A link's place in the queue, enough to put it back exactly where it was (undo). */
export interface QueueState {
	status: 'queued' | 'archived';
	queuedAt: number;
	readAt: number | null;
}
