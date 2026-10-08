import { describe, expect, it } from 'vitest';
import { likelyScore, scorecardFrom } from './predictions';

describe('likelyScore', () => {
	const now = Date.parse('2026-10-08T12:00:00Z');
	const daysAgo = (d: number) => new Date(now - d * 86_400_000);

	it('halves every three days', () => {
		expect(likelyScore(0.8, daysAgo(0), now)).toBeCloseTo(0.8);
		expect(likelyScore(0.8, daysAgo(3), now)).toBeCloseTo(0.4);
	});

	it('ranks an unscored item as a coin flip', () => {
		expect(likelyScore(null, daysAgo(0), now)).toBeCloseTo(0.5);
	});

	it('lets a fresh likely read beat an old sure one', () => {
		expect(likelyScore(0.7, daysAgo(0), now)).toBeGreaterThan(likelyScore(0.95, daysAgo(4), now));
	});
});

describe('scorecardFrom', () => {
	it('buckets by predicted chance and counts what happened', () => {
		const card = scorecardFrom([
			{ pOpen: 0.9, pKeep: 0.1, opened: true, starred: false },
			{ pOpen: 0.85, pKeep: 0.6, opened: false, starred: true },
			{ pOpen: 0.1, pKeep: null, opened: false, starred: false },
			{ pOpen: 1, pKeep: 0, opened: true, starred: false }
		]);
		expect(card.decided).toBe(4);
		expect(card.open.map((b) => [b.items, b.happened])).toEqual([
			[1, 0],
			[0, 0],
			[0, 0],
			[0, 0],
			[3, 2]
		]);
		expect(card.keep.find((b) => b.from === 0.6)).toMatchObject({ items: 1, happened: 1 });
		expect(card.keep.reduce((n, b) => n + b.items, 0)).toBe(3);
	});
});
