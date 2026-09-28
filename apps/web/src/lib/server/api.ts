import { json } from '@sveltejs/kit';
import { ApiError, type AgentContext } from './agent';

/** Every API response has `ok` and a human-readable `message` a Shortcut can show as-is. */
export const apiError = (status: number, message: string) =>
	json({ ok: false, message }, { status });

/** Runs an agent operation for an /api request, mapping errors to JSON responses. */
export async function runOp(
	event: { locals: App.Locals; url: URL },
	op: (ctx: AgentContext) => Promise<Record<string, unknown>>,
	status: number | ((result: Record<string, unknown>) => number) = 200
) {
	const { locals, url } = event;
	if (!locals.apiToken) return apiError(401, 'Missing or invalid API token');
	try {
		const result = await op({
			db: locals.db,
			user: locals.user,
			token: locals.apiToken,
			origin: url.origin
		});
		return json(
			{ ok: true, ...result },
			{ status: typeof status === 'function' ? status(result) : status }
		);
	} catch (err) {
		if (err instanceof ApiError) return apiError(err.status, err.message);
		throw err;
	}
}

/** The JSON body of a request, or an ApiError if it isn't a JSON object. */
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw new ApiError(400, 'Send a JSON object');
	}
	if (!body || typeof body !== 'object' || Array.isArray(body))
		throw new ApiError(400, 'Send a JSON object');
	return body as Record<string, unknown>;
}
