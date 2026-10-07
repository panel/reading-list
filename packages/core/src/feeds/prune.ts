import { sql } from 'drizzle-orm';
import type { Db } from '../db';

export interface PruneOptions {
	/** Only posts older than this are removed. */
	olderThanDays?: number;
	/**
	 * The newest posts per feed are always kept, however old. A feed still lists
	 * its recent posts, and deleting one would bring it back as unread on the
	 * next fetch.
	 */
	keepPerFeed?: number;
	now?: Date;
}

/**
 * Nightly cleanup: removes feed posts nobody saved that are both old and no
 * longer among their feed's newest posts, then feeds nobody follows. Read state
 * for removed posts goes with them (ON DELETE CASCADE), but what each user did
 * with them (opened, cited, dismissed) is first copied to entry_history, so
 * Slice 12's record of what was read and what was skipped outlives the posts.
 * Saved links are separate rows and are never touched.
 */
export async function pruneEntries(
	db: Db,
	{ olderThanDays = 30, keepPerFeed = 50, now = new Date() }: PruneOptions = {}
) {
	const cutoff = now.getTime() - olderThanDays * 24 * 60 * 60 * 1000;
	const doomed = sql`
		select c.id from (
			select fe.id,
				coalesce(fe.published_at, fe.created_at) as d,
				row_number() over (
					partition by fe.feed_id
					order by coalesce(fe.published_at, fe.created_at) desc
				) as rn
			from feed_entries fe
		) c
		where c.rn > ${keepPerFeed} and c.d < ${cutoff}
			and not exists (select 1 from links l where l.source_entry_id = c.id)`;
	await db.run(sql`
		insert into entry_history (user_id, entry_id, feed_id, url, title, author, published_at,
			read_at, opened_at, cited_at, dismissed_at, pruned_at)
		select es.user_id, fe.id, fe.feed_id, fe.url, fe.title, fe.author, fe.published_at,
			es.read_at, es.opened_at, es.cited_at, es.dismissed_at, ${now.getTime()}
		from entry_state es
		join feed_entries fe on fe.id = es.entry_id
		where fe.id in (${doomed})
			and (es.opened_at is not null or es.cited_at is not null or es.dismissed_at is not null)
		on conflict (user_id, entry_id) do nothing`);
	// RETURNING counts only these rows; D1's `changes` also counts cascaded deletes.
	const entries = await db.all<{ id: string }>(sql`
		delete from feed_entries
		where id in (${doomed})
		returning id`);
	const feeds = await db.all<{ id: string }>(sql`
		delete from feeds
		where not exists (select 1 from subscriptions s where s.feed_id = feeds.id)
		returning id`);
	return { entries: entries.length, feeds: feeds.length };
}
