import { describe, expect, it } from 'vitest';
import { isEmptySearch, parseSearch, toFtsMatch } from './search';

describe('parseSearch', () => {
	it('splits words, phrases, filters and exclusions', () => {
		expect(
			parseSearch(
				'boring tech tag:Architecture site:https://www.mcfunley.com/x is:ref "innovation tokens" -rewrite #craft'
			)
		).toEqual({
			terms: ['boring', 'tech'],
			phrases: ['innovation tokens'],
			excluded: ['rewrite'],
			tags: ['architecture', 'craft'],
			sites: ['mcfunley.com'],
			is: ['ref']
		});
	});

	it('maps is: synonyms and ignores unknown values', () => {
		expect(parseSearch('is:starred is:queue is:done is:bogus').is).toEqual([
			'ref',
			'queued',
			'archived'
		]);
	});

	it('treats unknown key:value pairs as words', () => {
		expect(parseSearch('author:ada c++').terms).toEqual(['author:ada', 'c++']);
	});

	it('handles negated phrases, empty quotes and dedupes filters', () => {
		const q = parseSearch('-"two words" "" tag:a tag:a');
		expect(q.excluded).toEqual(['two words']);
		expect(q.phrases).toEqual([]);
		expect(q.tags).toEqual(['a']);
	});

	it('knows an empty query', () => {
		expect(isEmptySearch(parseSearch('   '))).toBe(true);
		expect(isEmptySearch(parseSearch('is:ref'))).toBe(false);
	});
});

describe('toFtsMatch', () => {
	it('prefix-matches words, exact-matches phrases, and negates exclusions', () => {
		expect(toFtsMatch(parseSearch('boring tech "innovation tokens" -rewrite'))).toBe(
			'"boring"* "tech"* "innovation tokens" NOT "rewrite"'
		);
	});

	it('neutralizes FTS syntax in user input', () => {
		// Operators and punctuation become plain quoted tokens; quotes can't escape.
		expect(toFtsMatch(parseSearch('NEAR(a b) title:x OR "say ""hi"""'))).toBe(
			'"NEAR"* "a"* "b"* "title"* "x"* "OR"* "say" "hi"'
		);
	});

	it('returns null when there is no text to match', () => {
		expect(toFtsMatch(parseSearch('tag:x is:ref'))).toBeNull();
		expect(toFtsMatch(parseSearch('-only'))).toBeNull();
		expect(toFtsMatch(parseSearch('(*)'))).toBeNull();
	});
});
