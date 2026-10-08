import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	archiveUrl,
	categoryUrl,
	matchCategoryJob,
	isKick,
	KICK_URL,
	matchArchive,
	matchPoll,
	matchScore,
	pollUrl,
	PRUNE_CRON,
	scoreUrl
} from './poll';

describe('matchPoll', () => {
	const id = '01M3KW4JM8VYYV82Z9MC6HVAC0';

	it('accepts POST /poll/:id with a ULID', () => {
		expect(matchPoll(new Request(pollUrl(id), { method: 'POST' }))).toBe(id);
	});

	it.each([
		new Request(pollUrl(id)),
		new Request('https://fetcher.internal/poll/not-an-id', { method: 'POST' }),
		new Request(`https://fetcher.internal/poll/${id}/x`, { method: 'POST' }),
		new Request('https://fetcher.internal/', { method: 'POST' })
	])('rejects %s', (request) => {
		expect(matchPoll(request)).toBeNull();
	});
});

describe('matchArchive and isKick', () => {
	const id = '01M3KW4JM8VYYV82Z9MC6HVAC0';

	it('accepts POST /archive/:id and POST /archive/kick only', () => {
		expect(matchArchive(new Request(archiveUrl(id), { method: 'POST' }))).toBe(id);
		expect(matchArchive(new Request(archiveUrl(id)))).toBeNull();
		expect(matchArchive(new Request(KICK_URL, { method: 'POST' }))).toBeNull();
		expect(isKick(new Request(KICK_URL, { method: 'POST' }))).toBe(true);
		expect(isKick(new Request(KICK_URL))).toBe(false);
	});
});

describe('matchScore', () => {
	const user = '01M3KW4JM8VYYV82Z9MC6HVAC0';
	const item = '01M3KW4JM8VYYV82Z9MC6HVAC1';

	it('accepts POST /score/:kind/:user/:item', () => {
		expect(matchScore(new Request(scoreUrl('post', user, item), { method: 'POST' }))).toEqual({
			kind: 'post',
			userId: user,
			itemId: item
		});
	});

	it.each([
		new Request(scoreUrl('link', user, item)),
		new Request(`https://fetcher.internal/score/feed/${user}/${item}`, { method: 'POST' }),
		new Request(`https://fetcher.internal/score/post/${user}`, { method: 'POST' }),
		new Request(`https://fetcher.internal/score/post/${user}/a-b`, { method: 'POST' })
	])('rejects %s', (request) => {
		expect(matchScore(request)).toBeNull();
	});
});

describe('matchCategoryJob', () => {
	const user = '01M3KW4JM8VYYV82Z9MC6HVAC0';

	it.each(['categorize', 'categories/suggest', 'categories/check'] as const)(
		'accepts %s',
		(job) => {
			expect(matchCategoryJob(new Request(categoryUrl(job, user), { method: 'POST' }))).toEqual({
				job,
				userId: user
			});
		}
	);

	it.each([
		new Request(categoryUrl('categorize', user)),
		new Request(`https://fetcher.internal/categories/delete/${user}`, { method: 'POST' }),
		new Request(`https://fetcher.internal/categorize/${user}/x`, { method: 'POST' })
	])('rejects %s', (request) => {
		expect(matchCategoryJob(request)).toBeNull();
	});
});

describe('wrangler.jsonc', () => {
	it('schedules the prune cron the code checks for', () => {
		const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
		const crons = JSON.parse(config.match(/"crons":\s*(\[[^\]]*\])/)![1]) as string[];
		expect(crons).toContain(PRUNE_CRON);
		expect(crons).toContain('*/15 * * * *');
	});
});
