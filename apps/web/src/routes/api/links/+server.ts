import { jsonBody, runOp } from '$lib/server/api';
import { saveLinkOp, searchLinksOp } from '$lib/server/agent';
import type { RequestHandler } from './$types';

/** GET /api/links?q=…&limit=…: search (same syntax as the app), or the shared links to read when q is empty. */
export const GET: RequestHandler = (event) =>
	runOp(event, (ctx) =>
		searchLinksOp(ctx, {
			query: event.url.searchParams.get('q') ?? '',
			limit: event.url.searchParams.get('limit')
		})
	);

/** POST /api/links {url, note?, tags?}: save a link. Used by the iOS Shortcut. */
export const POST: RequestHandler = (event) =>
	runOp(
		event,
		async (ctx) => saveLinkOp(ctx, await jsonBody(event.request)),
		(result) => (result.existed ? 200 : 201)
	);
