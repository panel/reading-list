import { fail } from '@sveltejs/kit';
import { FeedNotFoundError, InvalidUrlError, OpmlParseError, parseOpml } from '@reading-list/core';
import {
	feedTitle,
	importFeeds,
	listSubscriptions,
	refreshOne,
	setFolder,
	subscribe,
	unsubscribe
} from '$lib/server/feeds';
import type { Actions, PageServerLoad } from './$types';

const MAX_OPML_BYTES = 1024 * 1024;

export const load: PageServerLoad = async ({ locals }) => {
	const subs = await listSubscriptions(locals.db, locals.user.id);
	const feeds = subs.map(({ feed, titleOverride, folder, unread }) => ({
		id: feed.id,
		title: feedTitle(feed, titleOverride),
		url: feed.url,
		siteUrl: feed.siteUrl,
		folder: folder ?? null,
		unread: Number(unread),
		lastFetchedAt: feed.lastFetchedAt,
		lastError: feed.lastError,
		errorCount: feed.errorCount
	}));
	const folders = [
		...new Set(feeds.map((f) => f.folder).filter((f): f is string => Boolean(f)))
	].sort((a, b) => a.localeCompare(b));
	return { feeds, folders };
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

	import: async ({ locals, request }) => {
		const file = (await request.formData()).get('opml');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { importError: 'Choose an OPML file to import.' });
		}
		if (file.size > MAX_OPML_BYTES) return fail(400, { importError: 'That file is over 1 MB.' });
		try {
			const list = parseOpml(await file.text());
			if (list.length === 0) return fail(400, { importError: 'No feeds found in that file.' });
			return { imported: await importFeeds(locals.db, locals.user.id, list) };
		} catch (err) {
			if (err instanceof OpmlParseError) return fail(400, { importError: err.message });
			throw err;
		}
	},

	folder: async ({ locals, request }) => {
		const form = await request.formData();
		const ok = await setFolder(
			locals.db,
			locals.user.id,
			String(form.get('feedId') ?? ''),
			String(form.get('folder') ?? '')
		);
		if (!ok) return fail(404, { error: 'You don’t follow that feed.' });
		return { foldered: true };
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
