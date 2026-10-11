import { describe, expect, it } from 'vitest';
import { AT_TOP_PX, atTop, awayLongEnough, RESUME_AFTER_MS } from './resume';

describe('awayLongEnough', () => {
	it('needs a real absence, not a glance at another app', () => {
		expect(awayLongEnough(1_000, 1_000 + RESUME_AFTER_MS)).toBe(true);
		expect(awayLongEnough(1_000, 1_000 + RESUME_AFTER_MS - 1)).toBe(false);
	});
});

describe('atTop', () => {
	it('counts the top of the page, not partway into a story', () => {
		expect(atTop(0)).toBe(true);
		expect(atTop(AT_TOP_PX)).toBe(true);
		expect(atTop(AT_TOP_PX + 1)).toBe(false);
		expect(atTop(2_400)).toBe(false);
	});
});
