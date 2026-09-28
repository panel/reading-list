import { getInbox, markAllRead } from '$lib/server/entries';
import { feedTitle, listSubscriptions, refreshSubscriptions } from '$lib/server/feeds';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const feedId = url.searchParams.get('feed') ?? undefined;
	const [inbox, subs] = await Promise.all([
		getInbox(locals.db, locals.user.id, { feedId }),
		listSubscriptions(locals.db, locals.user.id)
	]);
	return {
		inbox,
		feedId: feedId ?? null,
		feeds: subs.map(({ feed, titleOverride, unread }) => ({
			id: feed.id,
			title: feedTitle(feed, titleOverride),
			unread: Number(unread),
			failing: feed.errorCount >= 3
		}))
	};
};

export const actions: Actions = {
	markAllRead: async ({ locals, request }) => {
		const feedId = String((await request.formData()).get('feedId') ?? '') || undefined;
		return { markedRead: await markAllRead(locals.db, locals.user.id, feedId) };
	},

	refresh: async ({ locals }) => {
		const { newEntries, errors } = await refreshSubscriptions(locals.db, locals.user.id);
		return { refreshed: true, newEntries, errors };
	}
};
