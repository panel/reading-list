import { fail, redirect } from '@sveltejs/kit';
import { InvalidUrlError } from '@reading-list/core';
import { saveLink } from '$lib/server/links';
import type { Actions, PageServerLoad } from './$types';

// ?url=&note=&tags= prefill the form (used by the bookmarklet and share flows).
export const load: PageServerLoad = async ({ url }) => {
	return {
		prefill: {
			url: url.searchParams.get('url') ?? '',
			note: url.searchParams.get('note') ?? '',
			tags: url.searchParams.get('tags') ?? ''
		}
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const values = {
			url: String(form.get('url') ?? ''),
			note: String(form.get('note') ?? ''),
			tags: String(form.get('tags') ?? '')
		};

		let result;
		try {
			result = await saveLink(locals.db, locals.user.id, values);
		} catch (err) {
			if (err instanceof InvalidUrlError) return fail(400, { ...values, error: err.message });
			throw err;
		}

		redirect(303, `/links/${result.link.id}?${result.existed ? 'updated' : 'saved'}`);
	}
};
