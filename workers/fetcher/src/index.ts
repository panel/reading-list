import { eq } from 'drizzle-orm';
import {
	captureArchive,
	claimArchives,
	dailyCap,
	pruneArchives,
	pruneEntries,
	refreshFeed,
	scoreCandidates,
	scoreItem,
	type AiRunner
} from '@reading-list/core';
import { feeds, getDb, type Db } from '@reading-list/core/db';
import {
	archiveUrl,
	dueFeeds,
	isKick,
	matchArchive,
	matchPoll,
	matchScore,
	MAX_ARCHIVES_PER_RUN,
	MAX_SCORES_PER_RUN,
	pollUrl,
	PRUNE_CRON,
	scoreUrl
} from './poll';

/**
 * Workers AI, or a canned answer when AI_STUB is set: Workers AI only runs
 * remotely, so local runs without a Cloudflare login use the stub.
 */
function aiRunner(env: Env): AiRunner {
	if ((env as { AI_STUB?: string }).AI_STUB) {
		return {
			run: async () => ({
				answers: { open: { noul: 0.7 }, keep: { noul: 0.2 } },
				usage: { input_tokens: 1000 }
			})
		};
	}
	return { run: (model, input) => env.AI.run(model as never, input as never) };
}

/**
 * Picks inbox items that have no prediction yet and scores each in its own
 * invocation (through SELF): a cold model can take close to a minute.
 */
async function dispatchScores(db: Db, env: Env, now: Date) {
	const candidates = await scoreCandidates(db, MAX_SCORES_PER_RUN, { now: now.getTime() });
	const outcomes = await Promise.allSettled(
		candidates.map(async (c): Promise<{ status: string }> => {
			const response = await env.SELF.fetch(scoreUrl(c.kind, c.userId, c.itemId), {
				method: 'POST'
			});
			if (!response.ok) throw new Error(`score ${c.kind} ${c.itemId}: returned ${response.status}`);
			return (await response.json()) as { status: string };
		})
	);
	const statuses: Record<string, number> = {};
	for (const o of outcomes) {
		const status = o.status === 'fulfilled' ? o.value.status : 'error';
		statuses[status] = (statuses[status] ?? 0) + 1;
		if (o.status === 'rejected') console.error(o.reason);
	}
	return statuses;
}

/**
 * Claims pending readable copies and captures each in its own invocation
 * (through SELF), like feed polls, so a heavy page gets a fresh CPU budget.
 */
async function dispatchArchives(
	db: Db,
	env: Env,
	now: Date
): Promise<{ archived: number; ready: number }> {
	const ids = await claimArchives(db, MAX_ARCHIVES_PER_RUN, now);
	const outcomes = await Promise.allSettled(
		ids.map(async (id): Promise<{ status: string }> => {
			const response: Response = await env.SELF.fetch(archiveUrl(id), { method: 'POST' });
			if (!response.ok) throw new Error(`archive ${id}: returned ${response.status}`);
			return (await response.json()) as { status: string };
		})
	);
	const ready = outcomes.filter((o) => o.status === 'fulfilled' && o.value.status === 'ready');
	for (const o of outcomes) if (o.status === 'rejected') console.error(o.reason);
	return { archived: ids.length, ready: ready.length };
}

/**
 * Feed poller and page archiver. Every 15 minutes the cron picks the feeds
 * that are due and sends each to /poll/:id on this same Worker (through the
 * SELF service binding), so every feed is fetched and parsed in its own
 * invocation with its own CPU budget. Readable copies of saved links work the
 * same way through /archive/:id; the web app nudges /archive/kick after a
 * change so new copies don't wait for the cron. There are no public routes:
 * only SELF and the web app's FETCHER binding can call fetch().
 */
export default {
	async scheduled(controller, env) {
		const db = getDb(env.DB);
		const now = new Date(controller.scheduledTime);
		if (controller.cron === PRUNE_CRON) {
			const pruned = await pruneEntries(db);
			console.log(JSON.stringify({ pruned, prunedArchives: await pruneArchives(db, now) }));
			return;
		}
		// Copies first: they're few, and the feeds' fan-out can use the rest of the budget.
		const archives = await dispatchArchives(db, env, now);
		if (archives.archived) console.log(JSON.stringify(archives));
		const scores = await dispatchScores(db, env, now);
		if (Object.keys(scores).length) console.log(JSON.stringify({ scores }));
		const due = await dueFeeds(db, now);
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
		if (isKick(request)) {
			return Response.json(await dispatchArchives(getDb(env.DB), env, new Date()));
		}
		const score = matchScore(request);
		if (score) {
			const result = await scoreItem(getDb(env.DB), aiRunner(env), score, {
				cap: dailyCap(env.AI_DAILY_NEURONS)
			});
			if (result.status === 'failed') console.warn(`score ${score.itemId}: ${result.error}`);
			return Response.json(result);
		}
		const linkId = matchArchive(request);
		if (linkId) {
			const result = await captureArchive(getDb(env.DB), linkId);
			if (result.status === 'failed') console.warn(`archive ${linkId}: ${result.error}`);
			return Response.json(result);
		}

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
