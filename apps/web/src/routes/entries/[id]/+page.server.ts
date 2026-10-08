import { error, fail } from '@sveltejs/kit';
import {
	categoriesFor,
	CategoryError,
	KEEP_CANDIDATE,
	listCategories,
	predictionsFor,
	setItemCategory,
	stripTags
} from '@reading-list/core';
import {
	EntryHasNoUrlError,
	getEntry,
	keepEntry,
	linkForEntry,
	markCited,
	markOpened,
	markRead,
	setDismissed
} from '$lib/server/entries';
import { nextInboxItem } from '$lib/server/inbox';
import { citeLink, getLink, starLink } from '$lib/server/links';
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
		categories: (await listCategories(locals.db, locals.user.id)).map(({ slug, name }) => ({
			slug,
			name
		})),
		category:
			(await categoriesFor(locals.db, locals.user.id, [{ kind: 'post', id: entry.id }])).get(
				`post:${entry.id}`
			)?.slugs[0] ?? null,
		// Not starred yet, and likely to be: nudge to star it.
		candidate:
			((await predictionsFor(locals.db, locals.user.id, [{ kind: 'post', id: entry.id }])).get(
				`post:${entry.id}`
			)?.pKeep ?? 0) >= KEEP_CANDIDATE,
		// Starred already, whether from this post or saved by hand with the same URL.
		link: await linkForEntry(locals.db, locals.user.id, entry)
			.then((l) => l && getLink(locals.db, locals.user.id, l.id))
			.then((l) =>
				l ? { id: l.id, isReference: l.isReference, note: l.note, tags: l.tags } : null
			)
	};
};

export const actions: Actions = {
	// Posted by the page once it's open, rather than marked in load, so that
	// hover-preloading a post in the list doesn't count as reading it.
	// `opened` comes from the page itself (not the Mark read button) and also
	// records the open, which Slice 12 counts as having read it.
	read: async ({ locals, params, request }) => {
		const form = await request.formData();
		const read = form.get('read') !== 'false';
		if (!(await getEntry(locals.db, locals.user.id, params.id))) return fail(404);
		if (read && form.get('opened') === 'true') {
			await markOpened(locals.db, locals.user.id, params.id);
		} else {
			await markRead(locals.db, locals.user.id, params.id, read);
		}
		return { read };
	},

	/** Copy link: records the citation on the post, and on its link if it's saved. */
	cite: async ({ locals, params }) => {
		const entry = await getEntry(locals.db, locals.user.id, params.id);
		if (!entry) return fail(404);
		await markCited(locals.db, locals.user.id, entry.id);
		const link = await linkForEntry(locals.db, locals.user.id, entry);
		if (link) await citeLink(locals.db, locals.user.id, link.id);
		return { cited: true };
	},

	/** A correction: this post belongs in that category. */
	category: async ({ locals, params, request }) => {
		const slug = String((await request.formData()).get('category') ?? '');
		if (!(await getEntry(locals.db, locals.user.id, params.id))) return fail(404);
		try {
			await setItemCategory(locals.db, locals.user.id, 'post', params.id, slug);
		} catch (err) {
			if (err instanceof CategoryError) return fail(400, { message: err.message });
			throw err;
		}
		return { category: slug };
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
