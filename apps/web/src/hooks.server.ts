import { dev } from '$app/environment';
import { error, json, type Handle } from '@sveltejs/kit';
import { getDb } from '@reading-list/core/db';
import { kickArchiver } from '$lib/server/archive';
import { identify } from '$lib/server/auth';
import { authenticateToken, bearerToken } from '$lib/server/tokens';
import { findOrCreateUser } from '$lib/server/users';

/**
 * /api/* is reached without Cloudflare Access (a Bypass policy covers that path)
 * and is authenticated only by API tokens. Everything else requires Access.
 */
const isApiPath = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/');

/** Changes (form actions, API writes) can create work for the archiver. */
const isWrite = (method: string) => method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

export const handle: Handle = async ({ event, resolve }) => {
	const env = event.platform?.env;
	if (!env) error(500, 'Cloudflare platform bindings are unavailable');

	const db = getDb(env.DB);
	event.locals.db = db;

	if (isApiPath(event.url.pathname)) {
		const token = bearerToken(event.request.headers.get('authorization'));
		const auth =
			token && (await authenticateToken(db, token, (work) => event.platform?.ctx.waitUntil(work)));
		if (!auth) {
			return json(
				{ ok: false, message: 'Missing or invalid API token' },
				{ status: 401, headers: { 'www-authenticate': 'Bearer' } }
			);
		}
		event.locals.user = auth.user;
		event.locals.apiToken = auth.token;
		const response = await resolve(event);
		if (isWrite(event.request.method)) kickArchiver(event.platform, db, { dev });
		return response;
	}

	const identity = await identify(event.request, env, dev);
	if (!identity.ok) return new Response(identity.message, { status: identity.status });
	event.locals.user = await findOrCreateUser(db, identity.email);

	const response = await resolve(event);
	if (isWrite(event.request.method)) kickArchiver(event.platform, db, { dev });
	return response;
};
