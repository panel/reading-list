import { fail } from '@sveltejs/kit';
import { createToken, listTokens, revokeToken } from '$lib/server/tokens';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tokens = await listTokens(locals.db, locals.user.id);
	return {
		email: locals.user.email,
		apiUrl: new URL('/api/links', url).toString(),
		tokens: tokens.map(({ id, name, tokenPrefix, scopes, lastUsedAt, createdAt }) => ({
			id,
			name,
			tokenPrefix,
			scopes,
			lastUsedAt,
			createdAt
		}))
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { createError: 'Give the token a name, like “iPhone Shortcut”.' });
		const { token, record } = await createToken(locals.db, locals.user.id, name);
		// The only time the plain token is ever sent back.
		return { created: { id: record.id, name: record.name, token } };
	},

	revoke: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!(await revokeToken(locals.db, locals.user.id, id))) {
			return fail(404, { revokeError: 'That token doesn’t exist any more.' });
		}
		return { revoked: id };
	}
};
