import { error, fail } from '@sveltejs/kit';
import { stripTags } from '@reading-list/core';
import { getEntry, markRead, nextUnread } from '$lib/server/entries';
import { readingMinutes, sanitizeEntryHtml, withoutOpeningImage } from '$lib/server/sanitize';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const entry = await getEntry(locals.db, locals.user.id, params.id);
	if (!entry) error(404, 'Post not found');

	const base = entry.url ?? entry.siteUrl ?? entry.feedUrl;
	const html = withoutOpeningImage(
		entry.content ? sanitizeEntryHtml(entry.content, base) : '',
		entry.imageUrl
	);

	return {
		entry: { ...entry, content: undefined },
		html,
		minutes: readingMinutes(stripTags(entry.content ?? entry.summary ?? '')),
		next: await nextUnread(locals.db, locals.user.id, entry.id)
	};
};

export const actions: Actions = {
	// Posted by the page once it's open, rather than marked in load, so that
	// hover-preloading a post in the list doesn't count as reading it.
	read: async ({ locals, params, request }) => {
		const read = (await request.formData()).get('read') !== 'false';
		if (!(await getEntry(locals.db, locals.user.id, params.id))) return fail(404);
		await markRead(locals.db, locals.user.id, params.id, read);
		return { read };
	}
};
