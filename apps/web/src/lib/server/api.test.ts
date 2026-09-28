import { describe, expect, it } from 'vitest';
import { parseSaveLinkBody } from './api';

describe('parseSaveLinkBody', () => {
	it('accepts url with optional note and tags', () => {
		expect(parseSaveLinkBody({ url: 'https://a.co/x', note: 'hi', tags: 'a, b' })).toEqual({
			url: 'https://a.co/x',
			note: 'hi',
			tags: 'a, b'
		});
		expect(parseSaveLinkBody({ url: 'a.co', tags: ['a', 'b'] })).toEqual({
			url: 'a.co',
			note: undefined,
			tags: ['a', 'b']
		});
	});

	it('treats null fields as absent', () => {
		expect(parseSaveLinkBody({ url: 'a.co', note: null, tags: null })).toEqual({
			url: 'a.co',
			note: undefined,
			tags: undefined
		});
	});

	it.each([
		[null, 'JSON object'],
		[[], 'JSON object'],
		['https://a.co', 'JSON object'],
		[{}, '"url" is required'],
		[{ url: '  ' }, '"url" is required'],
		[{ url: 5 }, '"url" is required'],
		[{ url: 'a.co', note: 5 }, '"note" must be a string'],
		[{ url: 'a.co', tags: [1] }, '"tags" must be a string or a list of strings'],
		[{ url: 'a.co', tags: { a: 1 } }, '"tags" must be a string or a list of strings']
	])('rejects %j', (body, message) => {
		expect(() => parseSaveLinkBody(body)).toThrow(message);
	});
});
