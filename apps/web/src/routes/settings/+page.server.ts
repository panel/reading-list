import { fail } from '@sveltejs/kit';
import { ApiError, listActivity, undoActivity } from '$lib/server/agent';
import { createToken, listTokens, revokeToken } from '$lib/server/tokens';
import { PRESETS } from '$lib/tokens';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const [tokens, activity] = await Promise.all([
		listTokens(locals.db, locals.user.id),
		listActivity(locals.db, locals.user.id, 40)
	]);
	return {
		email: locals.user.email,
		apiUrl: new URL('/api/links', url).toString(),
		mcpUrl: new URL('/api/mcp', url).toString(),
		tokens: tokens.map(({ id, name, tokenPrefix, scopes, lastUsedAt, createdAt }) => ({
			id,
			name,
			tokenPrefix,
			scopes,
			lastUsedAt,
			createdAt
		})),
		activity: activity.map(({ id, actor, summary, undo, undoneAt, createdAt }) => ({
			id,
			actor,
			summary,
			canUndo: Boolean(undo) && !undoneAt,
			undoneAt,
			createdAt
		}))
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { createError: 'Give the token a name, like “iPhone Shortcut”.' });
		const preset = PRESETS.find((p) => p.id === form.get('preset'));
		if (!preset) return fail(400, { createError: 'Choose what the token may do.' });
		const { token, record } = await createToken(locals.db, locals.user.id, name, preset.scopes);
		// The only time the plain token is ever sent back.
		return { created: { id: record.id, name: record.name, token } };
	},

	revoke: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!(await revokeToken(locals.db, locals.user.id, id))) {
			return fail(404, { revokeError: 'That token doesn’t exist any more.' });
		}
		return { revoked: id };
	},

	undo: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		try {
			const row = await undoActivity(locals.db, locals.user.id, id);
			return { undone: row.summary };
		} catch (err) {
			if (err instanceof ApiError) return fail(err.status, { undoError: err.message });
			throw err;
		}
	}
};
