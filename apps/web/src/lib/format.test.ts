import { describe, expect, it } from 'vitest';
import {
	displayTitle,
	highlightSegments,
	hostname,
	relativeDay,
	siteLabel,
	toneFor,
	wantsDropCap
} from './format';

describe('relativeDay', () => {
	const now = new Date(2026, 8, 28, 15, 0); // Monday, Sep 28 2026

	it.each([
		[new Date(2026, 8, 28, 1, 0), 'today'],
		[new Date(2026, 8, 27, 23, 0), 'yesterday'],
		[new Date(2026, 8, 24, 12, 0), 'Thursday'],
		[new Date(2026, 8, 3, 12, 0), 'Sep 3'],
		[new Date(2025, 2, 3, 12, 0), 'Mar 3, 2025']
	])('%s → %s', (date, expected) => {
		expect(relativeDay(date, now)).toBe(expected);
	});
});

describe('siteLabel', () => {
	it('prefers the site name, else the hostname without www', () => {
		expect(siteLabel({ siteName: 'Example Blog', url: 'https://www.example.com/x' })).toBe(
			'Example Blog'
		);
		expect(siteLabel({ siteName: null, url: 'https://www.example.com/x' })).toBe('example.com');
		expect(hostname('https://sub.example.com/x')).toBe('sub.example.com');
	});
});

describe('toneFor', () => {
	it('is stable per key', () => {
		expect(toneFor('example.com')).toBe(toneFor('example.com'));
		expect(toneFor('example.com')).toMatch(/^#[0-9A-F]{6}$/);
	});
});

describe('displayTitle', () => {
	it('uses the title, else host and decoded path', () => {
		expect(displayTitle({ title: 'Hello', url: 'https://example.com/x' })).toBe('Hello');
		expect(displayTitle({ title: null, url: 'https://www.example.com/caf%C3%A9/menu' })).toBe(
			'example.com/café/menu'
		);
		expect(displayTitle({ title: null, url: 'https://example.com/' })).toBe('example.com');
		expect(displayTitle({ title: null, url: 'https://example.com/%E0%A4%A' })).toBe(
			'example.com/%E0%A4%A'
		);
	});
});

describe('wantsDropCap', () => {
	it('only for text long enough to wrap', () => {
		expect(wantsDropCap('short note')).toBe(false);
		expect(wantsDropCap(null)).toBe(false);
		expect(wantsDropCap('x'.repeat(120))).toBe(true);
	});
});

describe('highlightSegments', () => {
	it('splits marked matches from plain text', () => {
		expect(highlightSegments('Why the \u0001queue\u0002 should be \u0001empt\u0002ied')).toEqual([
			{ text: 'Why the ', match: false },
			{ text: 'queue', match: true },
			{ text: ' should be ', match: false },
			{ text: 'empt', match: true },
			{ text: 'ied', match: false }
		]);
	});

	it('keeps markup-looking text as text', () => {
		expect(highlightSegments('<b>\u0001x\u0002</b>')).toEqual([
			{ text: '<b>', match: false },
			{ text: 'x', match: true },
			{ text: '</b>', match: false }
		]);
	});
});
