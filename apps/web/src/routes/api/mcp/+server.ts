import { json } from '@sveltejs/kit';
import { handleMcp } from '$lib/server/mcp';
import type { RequestHandler } from './$types';

/**
 * MCP over Streamable HTTP: POST one JSON-RPC message, get a JSON response.
 * Stateless (no sessions, no server-initiated stream), authenticated by the
 * same Bearer tokens as the rest of /api. See docs/agents.md.
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	let message: unknown;
	try {
		message = await request.json();
	} catch {
		return json(
			{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
			{ status: 400 }
		);
	}
	const response = await handleMcp(
		{ db: locals.db, user: locals.user, token: locals.apiToken!, origin: url.origin },
		message
	);
	return response ? json(response) : new Response(null, { status: 202 });
};

// No server-to-client stream and no sessions to end.
const notAllowed: RequestHandler = () =>
	new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
export const GET = notAllowed;
export const DELETE = notAllowed;
