import { runOp } from '$lib/server/api';
import { recentReadingOp } from '$lib/server/agent';
import type { RequestHandler } from './$types';

/** GET /api/reading?days=&limit=: what you read and reacted to lately, strongest reaction first. */
export const GET: RequestHandler = (event) =>
	runOp(event, (ctx) =>
		recentReadingOp(ctx, {
			days: event.url.searchParams.get('days') ?? undefined,
			limit: event.url.searchParams.get('limit') ?? undefined
		})
	);
