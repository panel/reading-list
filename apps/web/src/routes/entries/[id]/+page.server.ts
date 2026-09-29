import { error, fail } from '@sveltejs/kit';
import { stripTags } from '@reading-list/core';
import {
	EntryHasNoUrlError,
	getEntry,
	keepEntry,
	linkForEntry,
	markRead,
	setDismissed
} from '$lib/server/entries';
import { nextInboxItem } from '$lib/server/inbox';
import { starLink } from '$lib/server/links';
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
		next: await nextInboxItem(locals.db, locals.user.id, entry.id),
		// Starred already, whether from this post or saved by hand with the same URL.
		link: await linkForEntry(locals.db, locals.user.id, entry).then((l) =>
			l ? { id: l.id, isReference: l.isReference } : null
		)
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
	},

	/** Star: keep as a reference, or unstar. */
	star: async ({ locals, params, request }) => {
		const starred = (await request.formData()).get('starred') !== 'false';
		const entry = await getEntry(locals.db, locals.user.id, params.id);
		if (!entry) return fail(404, { message: 'Post not found' });
		if (!starred) {
			const link = await linkForEntry(locals.db, locals.user.id, entry);
			if (link) await starLink(locals.db, locals.user.id, link.id, false);
			return { done: 'unstarred' as const };
		}
		try {
			const { link } = await keepEntry(locals.db, locals.user.id, entry, 'star');
			return { done: 'starred' as const, linkId: link.id };
		} catch (err) {
			if (err instanceof EntryHasNoUrlError) return fail(400, { message: err.message });
			throw err;
		}
	},

	dismiss: async ({ locals, params, request }) => {
		const dismissed = (await request.formData()).get('dismissed') !== 'false';
		if (!(await getEntry(locals.db, locals.user.id, params.id))) return fail(404);
		await setDismissed(locals.db, locals.user.id, params.id, dismissed);
		return { done: dismissed ? ('dismissed' as const) : ('restored' as const), id: params.id };
	}
};
