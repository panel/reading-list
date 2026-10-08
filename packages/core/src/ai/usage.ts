import { sql } from 'drizzle-orm';
import type { Db } from '../db';

/** Workers AI's free allowance resets at 00:00 UTC, so days are UTC days. */
export const usageDay = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Reserves neurons from today's cap before a model call: adds them to today's
 * total and returns true, or changes nothing and returns false if that would
 * go over the cap. One statement, so two Workers can't both take the last of
 * it. The cap is for the whole account, like Workers AI's own allowance.
 */
export async function reserveNeurons(
	db: Db,
	neurons: number,
	cap: number,
	now = new Date()
): Promise<boolean> {
	if (neurons > cap) return false;
	const rows = await db.all<{ neurons: number }>(sql`
		insert into ai_usage (day, neurons, calls) values (${usageDay(now)}, ${neurons}, 1)
		on conflict (day) do update set
			neurons = ai_usage.neurons + excluded.neurons,
			calls = ai_usage.calls + 1
		where ai_usage.neurons + excluded.neurons <= ${cap}
		returning neurons`);
	return rows.length > 0;
}

/**
 * Corrects today's total once a call reports what it actually used: adds the
 * difference from the estimate that was reserved (which may be negative).
 */
export async function settleNeurons(db: Db, estimated: number, actual: number, now = new Date()) {
	const delta = actual - estimated;
	if (delta === 0) return;
	await db.run(sql`
		update ai_usage set neurons = max(0, neurons + ${delta}) where day = ${usageDay(now)}`);
}

/** Parses the AI_DAILY_NEURONS variable; anything unusable falls back to the default. */
export function dailyCap(value: unknown, fallback = 2000): number {
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
