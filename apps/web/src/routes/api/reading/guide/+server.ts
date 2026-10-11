import { runOp } from '$lib/server/api';
import { INTERVIEW_GUIDE } from '$lib/server/interview';
import type { RequestHandler } from './$types';

/** GET /api/reading/guide: how an agent should interview you for a post (as in MCP). */
export const GET: RequestHandler = (event) =>
	runOp(event, async () => ({ guide: INTERVIEW_GUIDE }));
