/**
 * Notes as agents see them. In the app a link has one note and an article can
 * have highlights; to an agent they're all the user's notes on the article,
 * some on a quoted passage. Highlights made on a post and on the link it was
 * saved as belong to the same article, so both are gathered.
 */
import { highlightsForItems, type PlaceKind } from '@reading-list/core';
import type { Db, Highlight } from '@reading-list/core/db';

export interface AgentNote {
	/** The passage it's about (a highlight), or null for a note on the whole article. */
	quote: string | null;
	/** What the user wrote; null for a highlight without a note. */
	text: string | null;
	/** When it was saved (a link's own note: when the link last changed). */
	at: string;
}

export type ItemKey = { kind: PlaceKind; id: string };

/** The article's own note first, then its highlights in the order they were saved. */
export function composeNotes(
	own: { note: string | null; at: Date } | null,
	highlights: Pick<Highlight, 'id' | 'text' | 'note' | 'createdAt'>[]
): AgentNote[] {
	const notes: AgentNote[] = [];
	const text = own?.note?.trim();
	if (own && text) notes.push({ quote: null, text, at: own.at.toISOString() });
	const seen = new Set<string>();
	for (const h of [...highlights].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
		if (seen.has(h.id)) continue;
		seen.add(h.id);
		notes.push({ quote: h.text, text: h.note, at: h.createdAt.toISOString() });
	}
	return notes;
}

const keyOf = ({ kind, id }: ItemKey) => `${kind}:${id}`;

/**
 * Loads the highlights on these articles in one go, and returns a function
 * that gives an article's notes from its own note and the items it's made of
 * (a link and the post it came from).
 */
export async function loadNotes(db: Db, userId: string, items: (ItemKey | null | undefined)[]) {
	const keys = items.filter((k): k is ItemKey => Boolean(k?.id));
	const rows = keys.length ? await highlightsForItems(db, userId, keys) : [];
	const byItem = new Map<string, Highlight[]>();
	for (const row of rows) {
		const key = keyOf({ kind: row.itemKind, id: row.itemId });
		byItem.set(key, [...(byItem.get(key) ?? []), row]);
	}
	return (
		own: { note: string | null; at: Date } | null,
		...parts: (ItemKey | null | undefined)[]
	) =>
		composeNotes(
			own,
			parts.flatMap((k) => (k?.id ? (byItem.get(keyOf(k)) ?? []) : []))
		);
}

/** A link and the post it was saved from, if any. */
export const linkParts = (link: { id: string; sourceEntryId: string | null }): ItemKey[] => [
	{ kind: 'link', id: link.id },
	...(link.sourceEntryId ? [{ kind: 'post' as const, id: link.sourceEntryId }] : [])
];

/** A post and the link it was saved as, if any. */
export const postParts = (entry: { id: string; linkId: string | null }): ItemKey[] => [
	{ kind: 'post', id: entry.id },
	...(entry.linkId ? [{ kind: 'link' as const, id: entry.linkId }] : [])
];
