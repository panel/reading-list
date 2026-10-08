import { fail } from '@sveltejs/kit';
import { dev } from '$app/environment';
import {
	CategoryError,
	getCategorySettings,
	listCategories,
	saveCategories,
	scorecard
} from '@reading-list/core';
import { check, parseDraft, suggest } from '$lib/server/categories';
import { ApiError, listActivity, undoActivity } from '$lib/server/agent';
import { createToken, listTokens, revokeToken } from '$lib/server/tokens';
import { PRESETS } from '$lib/tokens';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const [tokens, activity, categories, categorySettings, card] = await Promise.all([
		listTokens(locals.db, locals.user.id),
		listActivity(locals.db, locals.user.id, 40),
		listCategories(locals.db, locals.user.id),
		getCategorySettings(locals.db, locals.user.id),
		scorecard(locals.db, locals.user.id)
	]);
	return {
		scorecard: card,
		categories,
		includeLibrary: categorySettings.includeLibrary,
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
	/** Drafts categories with the text model. Nothing is saved. */
	suggestCategories: async ({ locals, platform }) => {
		const result = await suggest(platform, { dev, db: locals.db }, locals.user.id);
		if (!result.ok) return fail(400, { categoryError: result.error });
		return { suggestions: result.value };
	},

	/** Sorts a sample with the draft and reports how it went. Nothing is saved. */
	checkCategories: async ({ locals, platform, request }) => {
		const draft = parseDraft((await request.formData()).get('draft'));
		const result = await check(platform, { dev, db: locals.db }, locals.user.id, draft);
		if (!result.ok) return fail(400, { categoryError: result.error });
		return { report: result.value };
	},

	saveCategories: async ({ locals, request }) => {
		const form = await request.formData();
		try {
			const saved = await saveCategories(locals.db, locals.user.id, parseDraft(form.get('draft')), {
				includeLibrary: form.get('includeLibrary') === 'on'
			});
			return { savedCategories: saved.length };
		} catch (err) {
			if (err instanceof CategoryError) return fail(400, { categoryError: err.message });
			throw err;
		}
	},

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
