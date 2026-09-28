import { describe, expect, it } from 'vitest';
import { ulid, ulidTime } from './ulid';

describe('ulid', () => {
	it('is 26 Crockford base32 characters', () => {
		expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	});

	it('round-trips the timestamp', () => {
		const now = 1_790_000_000_123;
		expect(ulidTime(ulid(now))).toBe(now);
	});

	it('sorts lexicographically by time', () => {
		const ids = [ulid(3_000), ulid(1_000), ulid(2_000)].sort();
		expect(ids.map(ulidTime)).toEqual([1_000, 2_000, 3_000]);
	});

	it('does not repeat', () => {
		const ids = new Set(Array.from({ length: 1000 }, () => ulid(0)));
		expect(ids.size).toBe(1000);
	});

	it('rejects out-of-range timestamps', () => {
		expect(() => ulid(-1)).toThrow(RangeError);
		expect(() => ulid(2 ** 48)).toThrow(RangeError);
	});
});
