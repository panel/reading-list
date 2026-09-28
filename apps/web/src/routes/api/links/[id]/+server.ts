import { jsonBody, runOp } from '$lib/server/api';
import { getLinkOp, updateLinkOp } from '$lib/server/agent';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	runOp(event, (ctx) => getLinkOp(ctx, event.params.id));

/** PATCH /api/links/:id {note?, appendNote?, tags?, status?: "queued"|"archived", reference?}. */
export const PATCH: RequestHandler = (event) =>
	runOp(event, async (ctx) => updateLinkOp(ctx, event.params.id, await jsonBody(event.request)));
