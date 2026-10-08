import { sql } from 'drizzle-orm';
import type { Db } from '../db';

/**
 * How many of each feed's posts the user opened, and how many they cleared
 * with Done without opening, over the last `days` days (by when they did it).
 * Includes posts already pruned (entry_history). A backlog marked read when
 * following a feed counts as neither.
 */
export async function feedOpenRates(db: Db, userId: string, days = 90, now = Date.now()) {
	const since = now - days * 24 * 60 * 60 * 1000;
	const rows = await db.all<{ feed_id: string; opened: number; skipped: number }>(sql`
		select feed_id, sum(opened) as opened, sum(skipped) as skipped from (
			select fe.feed_id,
				es.opened_at is not null as opened,
				es.opened_at is null and es.dismissed_at is not null as skipped,
				coalesce(es.opened_at, es.dismissed_at) as at
			from entry_state es
			join feed_entries fe on fe.id = es.entry_id
			where es.user_id = ${userId}
			union all
			select feed_id,
				opened_at is not null,
				opened_at is null and dismissed_at is not null,
				coalesce(opened_at, dismissed_at)
			from entry_history
			where user_id = ${userId}
		)
		where at >= ${since}
		group by feed_id`);
	return new Map(
		rows.map((r) => [r.feed_id, { opened: Number(r.opened), skipped: Number(r.skipped) }])
	);
}

export interface ProfileItem {
	title: string;
	source: string;
}

/** What the decision model is told about the reader: what they open, skip and keep. */
export interface Profile {
	feeds: { name: string; opened: number; skipped: number }[];
	starred: ProfileItem[];
	opened: ProfileItem[];
	skipped: ProfileItem[];
}

const LIST = 15;

/**
 * The reader's recent history, from live state and entry_history (posts the
 * prune removed). Titles only: enough to show taste, cheap in tokens.
 */
export async function loadProfile(db: Db, userId: string, now = Date.now()): Promise<Profile> {
	const feedName = sql`coalesce(s.title_override, f.title, f.url, 'a feed')`;
	const [rates, names, starred, opened, skipped] = await Promise.all([
		feedOpenRates(db, userId, 90, now),
		db.all<{ id: string; name: string }>(sql`
			select f.id as id, ${feedName} as name
			from subscriptions s join feeds f on f.id = s.feed_id
			where s.user_id = ${userId}`),
		db.all<ProfileItem>(sql`
			select coalesce(title, url) as title, coalesce(site_name, '') as source
			from links where user_id = ${userId} and is_reference = 1
			order by starred_at desc limit ${LIST}`),
		db.all<ProfileItem>(sql`
			select title, source from (
				select fe.title as title, ${feedName} as source, es.opened_at as at
				from entry_state es
				join feed_entries fe on fe.id = es.entry_id
				join feeds f on f.id = fe.feed_id
				left join subscriptions s on s.feed_id = f.id and s.user_id = es.user_id
				where es.user_id = ${userId} and es.opened_at is not null
				union all
				select eh.title, ${feedName}, eh.opened_at
				from entry_history eh
				left join feeds f on f.id = eh.feed_id
				left join subscriptions s on s.feed_id = f.id and s.user_id = eh.user_id
				where eh.user_id = ${userId} and eh.opened_at is not null
				union all
				select coalesce(l.title, l.url), coalesce(l.site_name, 'shared link'), l.opened_at
				from links l
				where l.user_id = ${userId} and l.opened_at is not null
			)
			where title is not null
			order by at desc limit ${LIST}`),
		db.all<ProfileItem>(sql`
			select title, source from (
				select fe.title as title, ${feedName} as source, es.dismissed_at as at
				from entry_state es
				join feed_entries fe on fe.id = es.entry_id
				join feeds f on f.id = fe.feed_id
				left join subscriptions s on s.feed_id = f.id and s.user_id = es.user_id
				where es.user_id = ${userId} and es.dismissed_at is not null and es.opened_at is null
				union all
				select eh.title, ${feedName}, eh.dismissed_at
				from entry_history eh
				left join feeds f on f.id = eh.feed_id
				left join subscriptions s on s.feed_id = f.id and s.user_id = eh.user_id
				where eh.user_id = ${userId} and eh.dismissed_at is not null and eh.opened_at is null
			)
			where title is not null
			order by at desc limit ${LIST}`)
	]);
	const nameOf = new Map(names.map((n) => [n.id, n.name]));
	const feeds = [...rates]
		.filter(([id, r]) => nameOf.has(id) && r.opened + r.skipped > 0)
		.map(([id, r]) => ({ name: nameOf.get(id)!, ...r }))
		.sort((a, b) => b.opened + b.skipped - (a.opened + a.skipped))
		.slice(0, 30);
	return { feeds, starred, opened, skipped };
}
