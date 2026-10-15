import { and, desc, eq, sql } from 'drizzle-orm';
import { highlights, type Db } from './db';
import type { PlaceKind } from './places';

/**
 * Highlights: a passage you selected in a reader and saved, with an optional
 * note and when you saved it. They're listed under the article and on the
 * Highlights page, and marked in the text when you come back.
 */

export const HIGHLIGHT_MAX_CHARS = 10_000;
export const HIGHLIGHT_NOTE_MAX_CHARS = 10_000;

export interface HighlightInput {
	text: string;
	note: string | null;
	block: number;
}

/** Tidies a note: blank means none. */
export function parseHighlightNote(value: unknown): string | null | undefined {
	const note = typeof value === 'string' ? value.trim() : '';
	if (note.length > HIGHLIGHT_NOTE_MAX_CHARS) return undefined;
	return note || null;
}

/**
 * Parses a highlight posted by a reader; null if it isn't one. Each line is
 * trimmed (a list keeps one item per line) and blank lines are dropped.
 */
export function parseHighlight(input: {
	text: unknown;
	note?: unknown;
	block?: unknown;
}): HighlightInput | null {
	if (typeof input.text !== 'string') return null;
	const text = input.text
		.split('\n')
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join('\n');
	if (!text || text.length > HIGHLIGHT_MAX_CHARS) return null;
	const note = parseHighlightNote(input.note);
	if (note === undefined) return null;
	const block = input.block == null || input.block === '' ? 0 : Number(input.block);
	if (!Number.isInteger(block) || block < 0 || block > 100_000) return null;
	return { text, note, block };
}

const ownItem = (userId: string, kind: PlaceKind, itemId: string) =>
	and(eq(highlights.userId, userId), eq(highlights.itemKind, kind), eq(highlights.itemId, itemId));

const own = (userId: string, id: string) =>
	and(eq(highlights.userId, userId), eq(highlights.id, id));

export async function addHighlight(
	db: Db,
	userId: string,
	kind: PlaceKind,
	itemId: string,
	{ text, note, block }: HighlightInput,
	source: { title: string | null; url: string | null },
	now = new Date()
) {
	const [row] = await db
		.insert(highlights)
		.values({
			userId,
			itemKind: kind,
			itemId,
			text,
			note,
			block,
			title: source.title,
			url: source.url,
			createdAt: now,
			updatedAt: now
		})
		.returning();
	return row;
}

/** An article's highlights, in reading order (then oldest first). */
export function highlightsFor(db: Db, userId: string, kind: PlaceKind, itemId: string) {
	return db
		.select()
		.from(highlights)
		.where(ownItem(userId, kind, itemId))
		.orderBy(highlights.block, highlights.createdAt);
}

/** All your highlights, newest first. */
export function listHighlights(db: Db, userId: string, limit = 200, offset = 0) {
	return db
		.select()
		.from(highlights)
		.where(eq(highlights.userId, userId))
		.orderBy(desc(highlights.createdAt), desc(highlights.id))
		.limit(limit)
		.offset(offset);
}

export async function countHighlights(db: Db, userId: string) {
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)` })
		.from(highlights)
		.where(eq(highlights.userId, userId));
	return n;
}

/** Replaces a highlight's note; false if it isn't yours. */
export async function setHighlightNote(
	db: Db,
	userId: string,
	id: string,
	note: string | null,
	now = new Date()
) {
	const rows = await db
		.update(highlights)
		.set({ note, updatedAt: now })
		.where(own(userId, id))
		.returning({ id: highlights.id });
	return rows.length > 0;
}

/** Deletes a highlight; false if it isn't yours. */
export async function deleteHighlight(db: Db, userId: string, id: string) {
	const rows = await db.delete(highlights).where(own(userId, id)).returning({ id: highlights.id });
	return rows.length > 0;
}

/** When an article goes (a link is deleted), its highlights go with it. */
export async function deleteHighlightsFor(db: Db, userId: string, kind: PlaceKind, itemId: string) {
	await db.delete(highlights).where(ownItem(userId, kind, itemId));
}
