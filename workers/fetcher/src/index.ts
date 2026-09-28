import { eq } from 'drizzle-orm';
import { pruneEntries, refreshFeed } from '@reading-list/core';
import { feeds, getDb } from '@reading-list/core/db';
import { dueFeeds, matchPoll, pollUrl, PRUNE_CRON } from './poll';

/**
 * Feed poller. Every 15 minutes the cron picks the feeds that are due and
 * sends each to /poll/:id on this same Worker (through the SELF service
 * binding), so every feed is fetched and parsed in its own invocation with its
 * own CPU budget. There are no public routes; only SELF can call fetch().
 */
export default {
	async scheduled(controller, env) {
		const db = getDb(env.DB);
		if (controller.cron === PRUNE_CRON) {
			console.log(JSON.stringify({ pruned: await pruneEntries(db) }));
			return;
		}
		const due = await dueFeeds(db, new Date(controller.scheduledTime));
		if (due.length === 0) return;

		const outcomes = await Promise.allSettled(
			due.map(async (feed) => {
				const response = await env.SELF.fetch(pollUrl(feed.id), { method: 'POST' });
				if (!response.ok) throw new Error(`${feed.url}: poll returned ${response.status}`);
				return (await response.json()) as { status: string; newEntries?: number };
			})
		);

		let newEntries = 0;
		let failed = 0;
		for (const outcome of outcomes) {
			if (outcome.status === 'rejected') {
				failed++;
				console.error(outcome.reason);
			} else {
				if (outcome.value.status === 'error') failed++;
				newEntries += outcome.value.newEntries ?? 0;
			}
		}
		console.log(JSON.stringify({ polled: due.length, newEntries, failed }));
	},

	async fetch(request, env) {
		const feedId = matchPoll(request);
		if (!feedId) return new Response('Not found', { status: 404 });

		const db = getDb(env.DB);
		const feed = await db.query.feeds.findFirst({ where: eq(feeds.id, feedId) });
		if (!feed) return Response.json({ status: 'error', error: 'unknown feed' }, { status: 404 });

		const result = await refreshFeed(db, feed);
		if (result.status === 'error') console.warn(`${feed.url}: ${result.error}`);
		return Response.json(result);
	}
} satisfies ExportedHandler<Env>;
