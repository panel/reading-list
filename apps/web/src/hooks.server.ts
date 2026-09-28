import { dev } from '$app/environment';
import { error, type Handle } from '@sveltejs/kit';
import { getDb } from '@reading-list/core/db';
import { identify } from '$lib/server/auth';
import { findOrCreateUser } from '$lib/server/users';

export const handle: Handle = async ({ event, resolve }) => {
	const env = event.platform?.env;
	if (!env) error(500, 'Cloudflare platform bindings are unavailable');

	const identity = await identify(event.request, env, dev);
	if (!identity.ok) return new Response(identity.message, { status: identity.status });

	const db = getDb(env.DB);
	event.locals.db = db;
	event.locals.user = await findOrCreateUser(db, identity.email);

	return resolve(event);
};
