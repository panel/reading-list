import { error, fail, redirect } from '@sveltejs/kit';
import { stripTags } from '@reading-list/core';
import { entryForLink } from '$lib/server/entries';
import {
	appendNote,
	deleteLink,
	finishLink,
	getLink,
	parseQueueState,
	requeueLink,
	setNote,
	setTags,
	starLink
} from '$lib/server/links';
import { nextInboxItem } from '$lib/server/inbox';
import { readingMinutes, sanitizeEntryHtml, withoutOpeningImage } from '$lib/server/sanitize';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const link = await getLink(locals.db, locals.user.id, params.id);
	if (!link) error(404, 'Link not found');
	const notice = url.searchParams.has('saved')
		? 'saved'
		: url.searchParams.has('updated')
			? 'updated'
			: null;
	const [next, entry] = await Promise.all([
		nextInboxItem(locals.db, locals.user.id, link.id),
		entryForLink(locals.db, locals.user.id, link)
	]);
	// A post from a feed you follow reads in the app, like it does from the inbox.
	const html = entry?.content
		? withoutOpeningImage(
				sanitizeEntryHtml(entry.content, entry.url ?? entry.siteUrl ?? entry.feedUrl),
				link.imageUrl
			)
		: '';
	return {
		link,
		notice,
		next,
		post: html
			? {
					id: entry!.id,
					feedTitle: entry!.feedTitle,
					author: entry!.author,
					date: entry!.publishedAt ?? entry!.createdAt,
					read: Boolean(entry!.readAt),
					minutes: readingMinutes(stripTags(entry!.content ?? '')),
					html
				}
			: null
	};
};

const notFound = () => fail(404, { message: 'That link doesn’t exist any more.' });

/**
 * Done returns the link's previous state so the client can offer Undo, and
 * doesn't redirect: the inbox posts here too and stays where it is.
 */
export const actions: Actions = {
	finish: async ({ locals, params }) => {
		const undo = await finishLink(locals.db, locals.user.id, params.id);
		if (!undo) return notFound();
		return { done: 'finished' as const, id: params.id, undo };
	},

	/** Back into the inbox: to an exact earlier state when undoing, else as newly shared. */
	restore: async ({ locals, params, request }) => {
		const form = await request.formData();
		const state = form.has('status')
			? parseQueueState({
					status: form.get('status'),
					queuedAt: form.get('queuedAt'),
					readAt: form.get('readAt')
				})
			: undefined;
		if (state === null) return fail(400, { message: 'Invalid undo state.' });
		if (!(await requeueLink(locals.db, locals.user.id, params.id, state))) return notFound();
		return { done: 'restored' as const, id: params.id };
	},

	star: async ({ locals, params, request }) => {
		const starred = (await request.formData()).get('starred') === 'true';
		if (!(await starLink(locals.db, locals.user.id, params.id, starred))) return notFound();
		return { done: starred ? ('starred' as const) : ('unstarred' as const), id: params.id };
	},

	/** Replaces the note and tags (the Edit form on the note). */
	edit: async ({ locals, params, request }) => {
		const form = await request.formData();
		const ok =
			(await setNote(locals.db, locals.user.id, params.id, String(form.get('note') ?? ''))) &&
			(await setTags(locals.db, locals.user.id, params.id, String(form.get('tags') ?? '')));
		if (!ok) return notFound();
		return { done: 'edited' as const, id: params.id };
	},

	/** Adds to the end of the note (the "Your notes" box after reading). */
	addNote: async ({ locals, params, request }) => {
		const note = String((await request.formData()).get('note') ?? '').trim();
		if (!note) return fail(400, { message: 'Write something first.' });
		if (!(await appendNote(locals.db, locals.user.id, params.id, note))) return notFound();
		return { done: 'noted' as const, id: params.id };
	},

	delete: async ({ locals, params }) => {
		if (!(await deleteLink(locals.db, locals.user.id, params.id))) return notFound();
		redirect(303, '/');
	}
};
