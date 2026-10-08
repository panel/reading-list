/**
 * Slice 12e: putting predictions to use. Reads the open/keep scores for
 * inbox items, ranks by them, and measures how well they've matched what the
 * user actually did (the scorecard in Settings).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { predictions, type Db } from '../db';
import { SCORE_MODEL } from './score';

/** Items scored at least this likely to be starred are marked as Library candidates. */
export const KEEP_CANDIDATE = 0.5;
/** "Likely reads" halves an item's score every this many days, so new things still rise. */
export const HALF_LIFE_DAYS = 3;
/** What an item without a prediction yet is ranked as. */
const UNSCORED = 0.5;

export interface Scores {
	pOpen: number | null;
	pKeep: number | null;
}

/** Scores for these items, keyed `kind:id`. */
export async function predictionsFor(
	db: Db,
	userId: string,
	items: { kind: 'post' | 'link'; id: string }[],
	model = SCORE_MODEL
): Promise<Map<string, Scores>> {
	const out = new Map<string, Scores>();
	for (const kind of ['post', 'link'] as const) {
		const ids = items.filter((i) => i.kind === kind).map((i) => i.id);
		// D1 allows 100 bound parameters per statement.
		for (let i = 0; i < ids.length; i += 90) {
			const rows = await db
				.select({ itemId: predictions.itemId, pOpen: predictions.pOpen, pKeep: predictions.pKeep })
				.from(predictions)
				.where(
					and(
						eq(predictions.userId, userId),
						eq(predictions.itemKind, kind),
						eq(predictions.model, model),
						isNull(predictions.error),
						inArray(predictions.itemId, ids.slice(i, i + 90))
					)
				);
			for (const r of rows) out.set(`${kind}:${r.itemId}`, { pOpen: r.pOpen, pKeep: r.pKeep });
		}
	}
	return out;
}

/** The "Likely reads" score: the chance of opening it, halved every HALF_LIFE_DAYS of age. */
export function likelyScore(pOpen: number | null, date: Date, now = Date.now()): number {
	const ageDays = Math.max(0, now - date.getTime()) / 86_400_000;
	return (pOpen ?? UNSCORED) * 0.5 ** (ageDays / HALF_LIFE_DAYS);
}

export interface Bucket {
	/** Lower bound of the predicted probability, e.g. 0.2 for 20–40%. */
	from: number;
	to: number;
	items: number;
	/** How many of them actually happened (opened, or starred). */
	happened: number;
}

export interface Scorecard {
	/** Items with a prediction whose outcome is known (opened or cleared). */
	decided: number;
	open: Bucket[];
	keep: Bucket[];
}

const EDGES = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];

function buckets(pairs: { p: number; happened: boolean }[]): Bucket[] {
	return EDGES.slice(0, -1).map((from, i) => {
		const to = EDGES[i + 1];
		const inside = pairs.filter((x) => x.p >= from && x.p < to);
		return {
			from,
			to: Math.min(1, to),
			items: inside.length,
			happened: inside.filter((x) => x.happened).length
		};
	});
}

/** Groups predictions by score and counts what actually happened. Pure, for testing. */
export function scorecardFrom(
	rows: { pOpen: number | null; pKeep: number | null; opened: boolean; starred: boolean }[]
): Scorecard {
	return {
		decided: rows.length,
		open: buckets(
			rows.filter((r) => r.pOpen !== null).map((r) => ({ p: r.pOpen!, happened: r.opened }))
		),
		keep: buckets(
			rows.filter((r) => r.pKeep !== null).map((r) => ({ p: r.pKeep!, happened: r.starred }))
		)
	};
}

/**
 * How the predictions have done: every scored item whose fate is known (it was
 * opened, or cleared without opening), with whether it was opened and starred.
 * Posts' outcomes come from live state or entry_history once pruned.
 */
export async function scorecard(db: Db, userId: string, model = SCORE_MODEL): Promise<Scorecard> {
	const rows = await db.all<{
		p_open: number | null;
		p_keep: number | null;
		opened: number;
		starred: number;
	}>(sql`
		select p.p_open, p.p_keep,
			case when p.item_kind = 'post'
				then coalesce(es.opened_at, eh.opened_at) is not null
				else l.opened_at is not null end as opened,
			case when p.item_kind = 'post'
				then exists (select 1 from links k where k.user_id = p.user_id
					and k.source_entry_id = p.item_id and k.is_reference = 1)
				else coalesce(l.is_reference, 0) end as starred
		from predictions p
		left join entry_state es on p.item_kind = 'post'
			and es.user_id = p.user_id and es.entry_id = p.item_id
		left join entry_history eh on p.item_kind = 'post'
			and eh.user_id = p.user_id and eh.entry_id = p.item_id
		left join links l on p.item_kind = 'link' and l.id = p.item_id and l.user_id = p.user_id
		where p.user_id = ${userId} and p.model = ${model} and p.error is null
			and case when p.item_kind = 'post'
				then coalesce(es.opened_at, eh.opened_at, es.dismissed_at, eh.dismissed_at) is not null
				else l.opened_at is not null or l.status = 'archived' end`);
	return scorecardFrom(
		rows.map((r) => ({
			pOpen: r.p_open,
			pKeep: r.p_keep,
			opened: Boolean(r.opened),
			starred: Boolean(r.starred)
		}))
	);
}
