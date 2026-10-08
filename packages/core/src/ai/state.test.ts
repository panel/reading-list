import { describe, expect, it } from 'vitest';
import { validateQuestions } from './decide';
import { firstWords, formatState, QUESTIONS } from './state';

const profile = {
	feeds: [{ name: 'Example Blog', opened: 7, skipped: 3 }],
	starred: [{ title: 'A guide worth keeping', source: 'example.org' }],
	opened: [],
	skipped: [{ title: 'Weekly roundup', source: 'Example Blog' }]
};

describe('formatState', () => {
	it('describes the reader, then the item', () => {
		const state = formatState(profile, {
			kind: 'link',
			title: 'Shared thing',
			source: 'example.com',
			note: 'Read before Friday',
			text: 'Body text'
		});
		expect(state).toContain('- Example Blog: opened 7 of 10');
		expect(state).toContain('- A guide worth keeping (example.org)');
		expect(state).toMatch(/Recently opened and read:\n- \(none yet\)/);
		expect(state).toContain('a link they saved to their own reading list themselves');
		expect(state).toContain('Their note: Read before Friday');
		expect(state.indexOf('# The reader')).toBeLessThan(state.indexOf('# The item'));
		expect(state.endsWith('Body text')).toBe(true);
	});

	it('leaves out what an item does not have', () => {
		const state = formatState(
			{ feeds: [], starred: [], opened: [], skipped: [] },
			{ kind: 'post', title: 'Post', source: 'Example Blog' }
		);
		expect(state).toContain('- (no history yet)');
		expect(state).not.toContain('Author:');
		expect(state).not.toContain('Their note:');
	});
});

describe('firstWords', () => {
	it('keeps the first words and marks the cut', () => {
		expect(firstWords('one  two\nthree four', 2)).toBe('one two …');
		expect(firstWords('one two', 5)).toBe('one two');
	});
});

it('asks questions the API accepts', () => {
	expect(() => validateQuestions(QUESTIONS)).not.toThrow();
});
