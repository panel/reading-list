import { jsonBody, runOp } from '$lib/server/api';
import { readEntryOp, triageEntryOp } from '$lib/server/agent';
import type { RequestHandler } from './$types';

/** GET /api/entries/:id: a post with its text (untrusted third-party content). */
export const GET: RequestHandler = (event) =>
	runOp(event, (ctx) => readEntryOp(ctx, event.params.id));

/** POST /api/entries/:id {action: "later"|"star"|"dismiss"|"read"|"unread"}. */
export const POST: RequestHandler = (event) =>
	runOp(event, async (ctx) =>
		triageEntryOp(ctx, event.params.id, (await jsonBody(event.request)).action)
	);
