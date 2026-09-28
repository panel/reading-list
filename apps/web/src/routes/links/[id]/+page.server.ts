import { error } from '@sveltejs/kit';
import { getLink } from '$lib/server/links';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const link = await getLink(locals.db, locals.user.id, params.id);
	if (!link) error(404, 'Link not found');
	const notice = url.searchParams.has('saved')
		? 'saved'
		: url.searchParams.has('updated')
			? 'updated'
			: null;
	return { link, notice };
};
