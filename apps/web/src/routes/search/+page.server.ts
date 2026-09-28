import { searchLinks } from '$lib/server/search';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const q = url.searchParams.get('q')?.trim() ?? '';
	const { results } = q ? await searchLinks(locals.db, locals.user.id, q) : { results: [] };
	return { q, results };
};
