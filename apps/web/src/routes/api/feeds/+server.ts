import { runOp } from '$lib/server/api';
import { listFeedsOp } from '$lib/server/agent';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => runOp(event, (ctx) => listFeedsOp(ctx));
