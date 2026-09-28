import { getInbox, markAllRead } from '$lib/server/entries';
import { feedTitle, listSubscriptions, refreshSubscriptions } from '$lib/server/feeds';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const feedId = url.searchParams.get('feed') ?? undefined;
	const folder = url.searchParams.get('folder') ?? undefined;
	const [inbox, subs] = await Promise.all([
		getInbox(locals.db, locals.user.id, { feedId, folder }),
		listSubscriptions(locals.db, locals.user.id)
	]);
	return {
		inbox,
		feedId: feedId ?? null,
		folder: folder ?? null,
		feeds: subs.map(({ feed, titleOverride, folder: feedFolder, unread }) => ({
			id: feed.id,
			title: feedTitle(feed, titleOverride),
			folder: feedFolder ?? null,
			unread: Number(unread),
			failing: feed.errorCount >= 3
		}))
	};
};

export const actions: Actions = {
	markAllRead: async ({ locals, request }) => {
		const form = await request.formData();
		const feedId = String(form.get('feedId') ?? '') || undefined;
		const folder = String(form.get('folder') ?? '') || undefined;
		return { markedRead: await markAllRead(locals.db, locals.user.id, { feedId, folder }) };
	},

	refresh: async ({ locals }) => {
		const { newEntries, errors } = await refreshSubscriptions(locals.db, locals.user.id);
		return { refreshed: true, newEntries, errors };
	}
};
