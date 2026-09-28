import { error } from '@sveltejs/kit';
import { exportLinks, toCsv } from '$lib/server/export';
import type { RequestHandler } from './$types';

/** /export/links.json and /export/links.csv: every saved link, as a download. */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (params.format !== 'json' && params.format !== 'csv') error(404, 'Not found');
	const rows = await exportLinks(locals.db, locals.user.id);
	const date = new Date().toISOString().slice(0, 10);
	const body = params.format === 'json' ? JSON.stringify(rows, null, 2) : toCsv(rows);
	return new Response(body, {
		headers: {
			'content-type':
				params.format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="reading-list-links-${date}.${params.format}"`,
			'cache-control': 'no-store'
		}
	});
};
