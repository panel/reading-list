import { describe, expect, it } from 'vitest';
import { chooseCanonical, mergeNote, parseQueueState } from './links';

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

	it('treats a repeat with different whitespace or case as a repeat', () => {
		expect(mergeNote('First line.\n\nSecond line.', 'first line. second   line.')).toBe(
			'First line.\n\nSecond line.'
		);
	});

	it('appends a different note and skips a repeat', () => {
		expect(mergeNote('first', 'second')).toBe('first\n\nsecond');
		expect(mergeNote('first\n\nsecond', 'second')).toBe('first\n\nsecond');
	});
});

describe('parseQueueState', () => {
	it('accepts a queued or archived state from form fields', () => {
		expect(parseQueueState({ status: 'queued', queuedAt: '1700000000000', readAt: '' })).toEqual({
			status: 'queued',
			queuedAt: 1700000000000,
			readAt: null
		});
		expect(parseQueueState({ status: 'archived', queuedAt: '1', readAt: '1700000000001' })).toEqual(
			{ status: 'archived', queuedAt: 1, readAt: 1700000000001 }
		);
	});

	it.each([
		{ status: 'deleted', queuedAt: '1', readAt: '' },
		{ status: 'queued', queuedAt: 'soon', readAt: '' },
		{ status: 'queued', queuedAt: '-5', readAt: '' },
		{ status: 'queued', queuedAt: '1.5', readAt: '' },
		{ status: 'queued', queuedAt: '1', readAt: 'x' },
		{ status: null, queuedAt: null, readAt: null }
	])('rejects %j', (input) => {
		expect(parseQueueState(input)).toBeNull();
	});
});
