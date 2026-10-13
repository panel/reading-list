import { and, desc, eq, sql } from 'drizzle-orm';
import { readingPlaces, type Db } from './db';
import { stripTags } from './feeds/parse';

/**
 * Long reads and short ones. A long read can be left partway: the reader keeps
 * your place, it waits under "Continue reading" at the top of the inbox, and
 * you can flip through short things (the Short filter) in the meantime.
 */

export const WORDS_PER_MINUTE = 230;

/** Reading time in minutes, as the readers show it (at least one). */
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / WORDS_PER_MINUTE));

/** This many minutes or more is a long read. */
export const LONG_READ_MINUTES = 5;

/** The fewest words that show as a long read (minutes are rounded). */
export const LONG_READ_WORDS = Math.ceil((LONG_READ_MINUTES - 0.5) * WORDS_PER_MINUTE);

export const isLongRead = (words: number | null | undefined) => (words ?? 0) >= LONG_READ_WORDS;

export type ReadLength = 'short' | 'long';

export const parseReadLength = (value: string | null | undefined): ReadLength | null =>
	value === 'short' || value === 'long' ? value : null;

export const countWords = (text: string) => text.match(/\S+/g)?.length ?? 0;

/** A post's words, from its HTML content or else its summary. */
export const entryWords = (content: string | null | undefined, summary?: string | null) =>
	countWords(stripTags(content ?? summary ?? ''));

/** A place is forgotten (and its post can be pruned) after this many days untouched. */
export const PLACE_KEEP_DAYS = 60;

export type PlaceKind = 'post' | 'link';

export interface Place {
	block: number;
	progress: number;
	updatedAt: Date;
}

/** Parses a place posted by a reader; null if it isn't one. */
export function parsePlace(input: { block: unknown; progress: unknown }) {
	const block = Number(input.block);
	const progress = Number(input.progress);
	if (!Number.isInteger(block) || block < 0 || block > 100_000) return null;
	if (!Number.isFinite(progress) || progress < 0 || progress > 1) return null;
	return { block, progress };
}

const own = (userId: string, kind: PlaceKind, id: string) =>
	and(
		eq(readingPlaces.userId, userId),
		eq(readingPlaces.itemKind, kind),
		eq(readingPlaces.itemId, id)
	);

export async function getPlace(
	db: Db,
	userId: string,
	kind: PlaceKind,
	id: string
): Promise<Place | null> {
	const [row] = await db
		.select({
			block: readingPlaces.block,
			progress: readingPlaces.progress,
			updatedAt: readingPlaces.updatedAt
		})
		.from(readingPlaces)
		.where(own(userId, kind, id))
		.limit(1);
	return row ?? null;
}

export async function savePlace(
	db: Db,
	userId: string,
	kind: PlaceKind,
	id: string,
	{ block, progress }: { block: number; progress: number },
	now = new Date()
) {
	await db
		.insert(readingPlaces)
		.values({ userId, itemKind: kind, itemId: id, block, progress, updatedAt: now })
		.onConflictDoUpdate({
			target: [readingPlaces.userId, readingPlaces.itemKind, readingPlaces.itemId],
			set: { block, progress, updatedAt: now }
		});
}

/** Finished (or started over): it's no longer in progress. */
export async function clearPlace(db: Db, userId: string, kind: PlaceKind, id: string) {
	await db.delete(readingPlaces).where(own(userId, kind, id));
}

/** The user's places, most recently read first. */
export function listPlaces(db: Db, userId: string, limit = 50) {
	return db
		.select()
		.from(readingPlaces)
		.where(eq(readingPlaces.userId, userId))
		.orderBy(desc(readingPlaces.updatedAt))
		.limit(limit);
}

/** Nightly: forget places nobody has come back to in PLACE_KEEP_DAYS. */
export async function prunePlaces(db: Db, now = new Date()) {
	const cutoff = now.getTime() - PLACE_KEEP_DAYS * 24 * 60 * 60 * 1000;
	const rows = await db.all<{ item_id: string }>(sql`
		delete from reading_places where updated_at < ${cutoff} returning item_id`);
	return rows.length;
}
