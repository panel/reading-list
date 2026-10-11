import { describe, expect, it } from 'vitest';
import { rankReading } from './reading';

describe('rankReading', () => {
	it('puts the strongest reaction first, and the most recent first among equals', () => {
		const at = (day: number) => new Date(Date.UTC(2026, 9, day));
		const ranked = rankReading([
			{ id: 'opened-old', score: 1, lastActivity: at(1) },
			{ id: 'starred', score: 3, lastActivity: at(2) },
			{ id: 'opened-new', score: 1, lastActivity: at(5) }
		]);
		expect(ranked.map((r) => r.id)).toEqual(['starred', 'opened-new', 'opened-old']);
	});
});
