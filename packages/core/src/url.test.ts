import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, InvalidUrlError, parseHttpUrl } from './url';

describe('parseHttpUrl', () => {
	it('adds https:// when the scheme is missing', () => {
		expect(parseHttpUrl('example.com/post').href).toBe('https://example.com/post');
	});

	it('keeps http', () => {
		expect(parseHttpUrl('http://example.com/').protocol).toBe('http:');
	});

	it.each(['', '   ', 'not a url', 'javascript:alert(1)', 'ftp://example.com/x', 'mailto:a@b.co'])(
		'rejects %j',
		(input) => {
			expect(() => parseHttpUrl(input)).toThrow(InvalidUrlError);
		}
	);
});

describe('canonicalizeUrl', () => {
	it.each([
		['https://Example.com/post', 'https://example.com/post'],
		['http://www.example.com/post', 'https://example.com/post'],
		['https://example.com/post/', 'https://example.com/post'],
		['https://example.com/post#section-2', 'https://example.com/post'],
		['https://example.com:443/post', 'https://example.com/post'],
		['https://example.com', 'https://example.com/'],
		['https://example.com/', 'https://example.com/'],
		[
			'https://example.com/post?utm_source=rss&utm_medium=feed&id=7',
			'https://example.com/post?id=7'
		],
		['https://example.com/post?b=2&fbclid=xyz&a=1', 'https://example.com/post?a=1&b=2'],
		['https://example.com:8080/post', 'https://example.com:8080/post'],
		['example.com/post', 'https://example.com/post']
	])('%s → %s', (input, expected) => {
		expect(canonicalizeUrl(input)).toBe(expected);
	});

	it('treats the same article from two sources as one', () => {
		expect(canonicalizeUrl('https://www.example.com/a/?utm_source=twitter#top')).toBe(
			canonicalizeUrl('http://example.com/a?utm_campaign=newsletter')
		);
	});
});
