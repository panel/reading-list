import { jsonBody, runOp } from '$lib/server/api';
import { addFeedOp, listFeedsOp } from '$lib/server/agent';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => runOp(event, (ctx) => listFeedsOp(ctx));

/** POST /api/feeds {url, folder?}: follow a site or feed; its current posts start out read. */
export const POST: RequestHandler = (event) =>
	runOp(event, async (ctx) => addFeedOp(ctx, await jsonBody(event.request)));
