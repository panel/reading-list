import { describe, expect, it } from 'vitest';
import { chooseCanonical, mergeNote } from './links';

describe('chooseCanonical', () => {
	it('uses the page canonical on the same site', () => {
		expect(
			chooseCanonical('https://www.example.com/p/1?utm_source=x', 'https://example.com/posts/one')
		).toBe('https://example.com/posts/one');
	});

	it('ignores a canonical on another site', () => {
		expect(chooseCanonical('https://example.com/p/1', 'https://medium.com/@x/one')).toBe(
			'https://example.com/p/1'
		);
	});

	it('ignores a canonical pointing at the homepage', () => {
		expect(chooseCanonical('https://example.com/p/1', 'https://example.com/')).toBe(
			'https://example.com/p/1'
		);
	});

	it('falls back to the final URL', () => {
		expect(chooseCanonical('https://example.com/p/1#x', null)).toBe('https://example.com/p/1');
	});
});

describe('mergeNote', () => {
	it('keeps the existing note when nothing new is entered', () => {
		expect(mergeNote('old', '  ')).toBe('old');
		expect(mergeNote(null, undefined)).toBeNull();
	});

	it('uses the new note when there is none', () => {
		expect(mergeNote(null, ' new ')).toBe('new');
		expect(mergeNote('  ', 'new')).toBe('new');
	});

	it('appends a different note and skips a repeat', () => {
		expect(mergeNote('first', 'second')).toBe('first\n\nsecond');
		expect(mergeNote('first\n\nsecond', 'second')).toBe('first\n\nsecond');
	});
});
