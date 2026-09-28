import { toOpml } from '@reading-list/core';
import { exportFeeds } from '$lib/server/feeds';
import type { RequestHandler } from './$types';

/** /export/feeds.opml: subscriptions for any other feed reader. */
export const GET: RequestHandler = async ({ locals }) => {
	const body = toOpml(await exportFeeds(locals.db, locals.user.id));
	const date = new Date().toISOString().slice(0, 10);
	return new Response(body, {
		headers: {
			'content-type': 'text/x-opml; charset=utf-8',
			'content-disposition': `attachment; filename="reading-list-feeds-${date}.opml"`,
			'cache-control': 'no-store'
		}
	});
};
