import { describe, expect, it } from 'vitest';
import { reactionReasons, reactionScore } from './reactions';

const none = { note: false, starred: false, cites: 0, opened: false, done: false };

describe('reactionScore', () => {
	it('ranks a note or a star above opening, and opening above finishing', () => {
		const opened = reactionScore({ ...none, opened: true });
		const done = reactionScore({ ...none, done: true });
		expect(reactionScore({ ...none, note: true })).toBeGreaterThan(opened);
		expect(reactionScore({ ...none, starred: true })).toBeGreaterThan(opened);
		expect(opened).toBeGreaterThan(done);
		expect(done).toBeGreaterThan(reactionScore(none));
	});

	it('caps the weight of repeated shares', () => {
		expect(reactionScore({ ...none, cites: 10 })).toBe(reactionScore({ ...none, cites: 3 }));
	});
});

describe('reactionReasons', () => {
	it('says what the user did', () => {
		expect(
			reactionReasons({ note: true, starred: true, cites: 2, opened: true, done: false })
		).toEqual(['wrote a note', 'starred it', 'shared the link 2×', 'opened it']);
		expect(reactionReasons({ ...none, cites: 1, done: true })).toEqual([
			'shared the link',
			'finished it'
		]);
		expect(reactionReasons(none)).toEqual([]);
	});
});
