import { json } from '@sveltejs/kit';
import { displayTitle, siteLabel } from '$lib/format';
import { searchLinks } from '$lib/server/search';
import type { RequestHandler } from './$types';

/** Results for the ⌘K palette. A page endpoint (not /api), so it uses the Access session. */
export const GET: RequestHandler = async ({ locals, url }) => {
	const q = url.searchParams.get('q')?.trim() ?? '';
	if (!q) return json({ results: [] });
	const { results } = await searchLinks(locals.db, locals.user.id, q, { limit: 8 });
	return json({
		results: results.map((r) => ({
			id: r.id,
			url: r.url,
			title: displayTitle(r),
			site: siteLabel(r),
			isReference: r.isReference,
			snippet: r.snippet
		}))
	});
};
