import { parseSearch } from '@reading-list/core';
import { libraryFacets, searchLinks } from '$lib/server/search';
import type { PageServerLoad } from './$types';

/** The Library is search scoped to references (is:ref), plus tag and site facets. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const q = url.searchParams.get('q')?.trim() ?? '';
	const tag = url.searchParams.get('tag')?.trim().toLowerCase() || null;
	const site = url.searchParams.get('site')?.trim().toLowerCase() || null;

	const query = parseSearch(q);
	query.is = [...new Set([...query.is, 'ref' as const])];
	if (tag) query.tags.push(tag);
	if (site) query.sites.push(site);

	const [{ results }, facets] = await Promise.all([
		searchLinks(locals.db, locals.user.id, query, { limit: 200, orderByStarred: true }),
		libraryFacets(locals.db, locals.user.id)
	]);
	return { q, tag, site, results, facets };
};
