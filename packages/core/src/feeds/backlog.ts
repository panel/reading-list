import { sql } from 'drizzle-orm';
import type { Db } from '../db';

/**
 * Marks the posts a feed already has as read, so following a feed brings only
 * its new posts into the inbox, not its whole archive. For one user (who just
 * followed it), or for everyone following it (the feed's first fetch).
 * Posts the user has already opened, starred or dismissed keep their state.
 */
export async function markBacklogRead(
	db: Db,
	feedIds: string[],
	userId?: string,
	now = new Date()
): Promise<number> {
	let marked = 0;
	// D1 allows 100 bound parameters per statement.
	for (let i = 0; i < feedIds.length; i += 90) {
		const ids = feedIds.slice(i, i + 90);
		// (An INSERT … SELECT upsert needs a WHERE clause, or SQLite reads ON CONFLICT as part of a join.)
		const result = await db.run(sql`
			insert into entry_state (user_id, entry_id, read_at)
			select s.user_id, fe.id, ${now.getTime()}
			from feed_entries fe
			join subscriptions s on s.feed_id = fe.feed_id
			where fe.feed_id in (${sql.join(
				ids.map((id) => sql`${id}`),
				sql`, `
			)}) ${userId ? sql`and s.user_id = ${userId}` : sql``}
			on conflict (user_id, entry_id) do nothing
		`);
		marked += result.meta.changes ?? 0;
	}
	return marked;
}
