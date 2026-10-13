import { describe, expect, it } from 'vitest';
import {
	entryWords,
	isLongRead,
	LONG_READ_MINUTES,
	LONG_READ_WORDS,
	parsePlace,
	parseReadLength,
	readingMinutes
} from './places';

describe('isLongRead', () => {
	it('agrees with the minutes the reader shows', () => {
		expect(readingMinutes(LONG_READ_WORDS)).toBe(LONG_READ_MINUTES);
		expect(readingMinutes(LONG_READ_WORDS - 1)).toBe(LONG_READ_MINUTES - 1);
		expect(isLongRead(LONG_READ_WORDS)).toBe(true);
		expect(isLongRead(LONG_READ_WORDS - 1)).toBe(false);
	});

	it('treats an unknown length as short', () => {
		expect(isLongRead(null)).toBe(false);
	});
});

describe('entryWords', () => {
	it('counts the text, not the markup, and falls back to the summary', () => {
		expect(entryWords('<p class="lead">One two</p><p>three</p>')).toBe(3);
		expect(entryWords(null, 'just a summary')).toBe(3);
		expect(entryWords(null, null)).toBe(0);
	});
});

describe('parsePlace', () => {
	it('accepts a block and a share read', () => {
		expect(parsePlace({ block: '12', progress: '0.4' })).toEqual({ block: 12, progress: 0.4 });
	});

	it('rejects anything else', () => {
		expect(parsePlace({ block: '-1', progress: '0.4' })).toBeNull();
		expect(parsePlace({ block: '1.5', progress: '0.4' })).toBeNull();
		expect(parsePlace({ block: '3', progress: '1.2' })).toBeNull();
		expect(parsePlace({ block: null, progress: 'x' })).toBeNull();
	});
});

describe('parseReadLength', () => {
	it('knows short and long', () => {
		expect(parseReadLength('short')).toBe('short');
		expect(parseReadLength('long')).toBe('long');
		expect(parseReadLength('medium')).toBeNull();
		expect(parseReadLength(null)).toBeNull();
	});
});
