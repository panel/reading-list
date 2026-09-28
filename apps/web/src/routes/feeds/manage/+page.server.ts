import { fail } from '@sveltejs/kit';
import { FeedNotFoundError, InvalidUrlError } from '@reading-list/core';
import {
	feedTitle,
	listSubscriptions,
	refreshOne,
	subscribe,
	unsubscribe
} from '$lib/server/feeds';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const subs = await listSubscriptions(locals.db, locals.user.id);
	return {
		feeds: subs.map(({ feed, titleOverride, unread }) => ({
			id: feed.id,
			title: feedTitle(feed, titleOverride),
			url: feed.url,
			siteUrl: feed.siteUrl,
			unread: Number(unread),
			lastFetchedAt: feed.lastFetchedAt,
			lastError: feed.lastError,
			errorCount: feed.errorCount
		}))
	};
};

export const actions: Actions = {
	subscribe: async ({ locals, request }) => {
		const url = String((await request.formData()).get('url') ?? '');
		try {
			const { feed, newEntries, alreadySubscribed } = await subscribe(
				locals.db,
				locals.user.id,
				url
			);
			return { subscribed: { title: feedTitle(feed), newEntries, alreadySubscribed } };
		} catch (err) {
			if (err instanceof FeedNotFoundError || err instanceof InvalidUrlError) {
				return fail(400, { url, error: err.message });
			}
			throw err;
		}
	},

	refresh: async ({ locals, request }) => {
		const feedId = String((await request.formData()).get('feedId') ?? '');
		const result = await refreshOne(locals.db, locals.user.id, feedId);
		if (!result) return fail(404, { error: 'You don’t follow that feed.' });
		return { refreshedOne: result };
	},

	unsubscribe: async ({ locals, request }) => {
		const feedId = String((await request.formData()).get('feedId') ?? '');
		if (!(await unsubscribe(locals.db, locals.user.id, feedId))) {
			return fail(404, { error: 'You don’t follow that feed.' });
		}
		return { unsubscribed: true };
	}
};
