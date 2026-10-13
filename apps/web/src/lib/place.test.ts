import { describe, expect, it } from 'vitest';
import { currentBlock, minutesLeft, progressAt, TOP_PX } from './place';

describe('currentBlock', () => {
	it('is the first block still on screen', () => {
		expect(currentBlock([-400, -10, 300, 900])).toBe(2);
		expect(currentBlock([TOP_PX, TOP_PX + 1])).toBe(1);
	});

	it('is the first block at the top of the article', () => {
		expect(currentBlock([500, 900])).toBe(0);
	});

	it('is the last block once you’ve scrolled past them all', () => {
		expect(currentBlock([-900, -500])).toBe(1);
		expect(currentBlock([])).toBe(0);
	});
});

describe('progressAt', () => {
	it('counts the words before the block', () => {
		expect(progressAt([100, 100, 200], 0)).toBe(0);
		expect(progressAt([100, 100, 200], 2)).toBe(0.5);
		expect(progressAt([100, 100, 200], 9)).toBe(1);
	});

	it('is zero for an article with no words', () => {
		expect(progressAt([0, 0], 1)).toBe(0);
	});
});

describe('minutesLeft', () => {
	it('scales the reading time and never says zero', () => {
		expect(minutesLeft(20, 0.4)).toBe(12);
		expect(minutesLeft(20, 0.99)).toBe(1);
	});
});
