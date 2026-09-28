import { describe, expect, it } from 'vitest';
import { parseTags } from './tags';

describe('parseTags', () => {
	it('splits on commas and whitespace', () => {
		expect(parseTags('architecture, reading  go')).toEqual(['architecture', 'reading', 'go']);
	});

	it('strips leading # and lowercases', () => {
		expect(parseTags('#Craft #HUMOR')).toEqual(['craft', 'humor']);
	});

	it('dedupes', () => {
		expect(parseTags('go, Go, #go')).toEqual(['go']);
	});

	it('keeps hyphens, underscores and non-ASCII letters, drops other punctuation', () => {
		expect(parseTags('reading-list, to_read, café, what?!')).toEqual([
			'reading-list',
			'to_read',
			'café',
			'what'
		]);
	});

	it('accepts arrays and empty input', () => {
		expect(parseTags(['a', 'b c'])).toEqual(['a', 'b', 'c']);
		expect(parseTags('')).toEqual([]);
		expect(parseTags(null)).toEqual([]);
		expect(parseTags(' , # ,')).toEqual([]);
	});

	it('caps tag length and count', () => {
		expect(parseTags('x'.repeat(100))[0]).toHaveLength(40);
		expect(parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(' '))).toHaveLength(20);
	});
});
