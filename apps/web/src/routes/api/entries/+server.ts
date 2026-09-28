import { runOp } from '$lib/server/api';
import { listEntriesOp } from '$lib/server/agent';
import type { RequestHandler } from './$types';

/** GET /api/entries?unread=true&feed=…&limit=…: posts from followed feeds, newest first. */
export const GET: RequestHandler = (event) =>
	runOp(event, (ctx) =>
		listEntriesOp(ctx, {
			unread: event.url.searchParams.get('unread') ?? true,
			feed: event.url.searchParams.get('feed'),
			limit: event.url.searchParams.get('limit')
		})
	);
