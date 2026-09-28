import { describe, expect, it } from 'vitest';
import { matchPoll, pollUrl } from './poll';

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
