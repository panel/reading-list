import { fail, type RequestEvent } from '@sveltejs/kit';
import {
	addHighlight,
	deleteHighlight,
	highlightsFor,
	parseHighlight,
	parseHighlightNote,
	setHighlightNote,
	type PlaceKind
} from '@reading-list/core';
import type { Db } from '@reading-list/core/db';

/** An article's highlights, as the readers show them. */
export async function readerHighlights(db: Db, userId: string, kind: PlaceKind, id: string) {
	return (await highlightsFor(db, userId, kind, id)).map(
		({ id, text, note, block, createdAt }) => ({ id, text, note, block, createdAt })
	);
}

/**
 * The readers' highlight actions: `highlight` saves a selection (text, block,
 * optional note), `highlightNote` changes a note, `unhighlight` deletes one.
 * `source` finds the article (null if it isn't yours) and what to call it.
 */
export function highlightActions(
	kind: PlaceKind,
	source: (
		event: RequestEvent
	) => Promise<{ id: string; title: string | null; url: string | null } | null>
) {
	return {
		highlight: async (event: RequestEvent) => {
			const { locals, request } = event;
			const form = await request.formData();
			const item = await source(event);
			if (!item) return fail(404, { message: 'That article doesn’t exist any more.' });
			const input = parseHighlight({
				text: form.get('text'),
				note: form.get('note'),
				block: form.get('block')
			});
			if (!input) return fail(400, { message: 'Select some text to highlight first.' });
			const row = await addHighlight(locals.db, locals.user.id, kind, item.id, input, item);
			return { highlighted: row.id };
		},

		highlightNote: async ({ locals, request }: RequestEvent) => {
			const form = await request.formData();
			const note = parseHighlightNote(form.get('note'));
			if (note === undefined) return fail(400, { message: 'That note is too long.' });
			const id = String(form.get('id') ?? '');
			if (!(await setHighlightNote(locals.db, locals.user.id, id, note)))
				return fail(404, { message: 'That highlight doesn’t exist any more.' });
			return { highlightNote: id };
		},

		unhighlight: async ({ locals, request }: RequestEvent) => {
			const id = String((await request.formData()).get('id') ?? '');
			if (!(await deleteHighlight(locals.db, locals.user.id, id)))
				return fail(404, { message: 'That highlight doesn’t exist any more.' });
			return { unhighlighted: id };
		}
	};
}
