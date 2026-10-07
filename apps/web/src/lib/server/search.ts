import { sql, type SQL } from 'drizzle-orm';
import { isEmptySearch, parseSearch, toFtsMatch, type SearchQuery } from '@reading-list/core';
import type { Db, Link } from '@reading-list/core/db';
import { withTags, type LinkWithTags } from './links';

/** snippet() wraps matches in these; the UI turns them into <mark> without parsing HTML. */
export const MATCH_START = '\u0001';
export const MATCH_END = '\u0002';

export type SearchResult = LinkWithTags & { snippet: string | null };

// Column weights for bm25, in links_fts column order:
// title, description, note, tags, site, author, url, body (a starred link's article text).
const RANK = sql`bm25(links_fts, 10.0, 2.0, 5.0, 6.0, 3.0, 3.0, 1.0, 1.0)`;

function filters(q: SearchQuery): SQL[] {
	const where: SQL[] = [];
	for (const tag of q.tags) {
		where.push(sql`exists (
			select 1 from link_tags lt join tags t on t.id = lt.tag_id
			where lt.link_id = l.id and t.name = ${tag})`);
	}
	if (q.sites.length) {
		where.push(
			sql`(${sql.join(
				q.sites.map(
					(site) => sql`(l.canonical_url like ${`https://${site}/%`}
						or l.canonical_url like ${`https://${site}:%`}
						or l.canonical_url like ${`https://%.${site}/%`}
						or lower(coalesce(l.site_name, '')) = ${site})`
				),
				sql` or `
			)})`
		);
	}
	if (q.is.includes('ref')) where.push(sql`l.is_reference = 1`);
	if (q.is.includes('queued')) where.push(sql`l.status = 'queued'`);
	if (q.is.includes('archived')) where.push(sql`l.status = 'archived'`);
	return where;
}

type Row = Record<string, unknown>;

// Raw rows come back with SQL column names; map them to the Link shape.
const date = (v: unknown) => (v == null ? null : new Date(Number(v)));
function toLink(r: Row): Link {
	return {
		id: String(r.id),
		userId: String(r.user_id),
		url: String(r.url),
		canonicalUrl: String(r.canonical_url),
		title: (r.title as string) ?? null,
		siteName: (r.site_name as string) ?? null,
		author: (r.author as string) ?? null,
		description: (r.description as string) ?? null,
		imageUrl: (r.image_url as string) ?? null,
		faviconUrl: (r.favicon_url as string) ?? null,
		note: (r.note as string) ?? null,
		status: r.status as Link['status'],
		isReference: Boolean(r.is_reference),
		source: r.source as Link['source'],
		sourceEntryId: (r.source_entry_id as string) ?? null,
		savedAt: date(r.saved_at)!,
		queuedAt: date(r.queued_at)!,
		readAt: date(r.read_at),
		starredAt: date(r.starred_at),
		openedAt: date(r.opened_at),
		citedAt: date(r.cited_at),
		citeCount: Number(r.cite_count ?? 0),
		updatedAt: date(r.updated_at)!
	};
}

/**
 * Searches the user's links. Text goes through the FTS index (ranked, with a
 * highlighted snippet); tag:/site:/is: become SQL filters. With filters but no
 * text, results are the newest matching links.
 */
export async function searchLinks(
	db: Db,
	userId: string,
	input: string | SearchQuery,
	{ limit = 50, orderByStarred = false } = {}
): Promise<{ query: SearchQuery; results: SearchResult[] }> {
	const query = typeof input === 'string' ? parseSearch(input) : input;
	if (isEmptySearch(query)) return { query, results: [] };

	const match = toFtsMatch(query);
	const where = sql.join([sql`l.user_id = ${userId}`, ...filters(query)], sql` and `);

	let rows: Row[];
	if (match) {
		rows = await db.all<Row>(sql`
			select l.*, snippet(links_fts, -1, char(1), char(2), '…', 14) as snippet
			from links_fts join links l on l.rowid = links_fts.rowid
			where links_fts match ${match} and ${where}
			order by ${RANK}
			limit ${limit}`);
	} else {
		const order = orderByStarred
			? sql`coalesce(l.starred_at, l.saved_at) desc`
			: sql`l.saved_at desc`;
		rows = await db.all<Row>(sql`
			select l.*, null as snippet from links l
			where ${where}
			order by ${order}, l.id desc
			limit ${limit}`);
	}

	const links = await withTags(db, rows.map(toLink));
	return {
		query,
		results: links.map((link, i) => ({ ...link, snippet: (rows[i].snippet as string) ?? null }))
	};
}

/** Tag and site counts across the user's references, for browsing the Library. */
export async function libraryFacets(db: Db, userId: string) {
	const [tags, sites, [{ total }]] = await Promise.all([
		db.all<{ name: string; n: number }>(sql`
			select t.name as name, count(*) as n
			from links l join link_tags lt on lt.link_id = l.id join tags t on t.id = lt.tag_id
			where l.user_id = ${userId} and l.is_reference = 1
			group by t.name order by n desc, t.name limit 40`),
		db.all<{ host: string; n: number }>(sql`
			select substr(l.canonical_url, 9, instr(substr(l.canonical_url, 9), '/') - 1) as host, count(*) as n
			from links l
			where l.user_id = ${userId} and l.is_reference = 1
			group by host order by n desc, host limit 12`),
		db.all<{ total: number }>(sql`
			select count(*) as total from links l where l.user_id = ${userId} and l.is_reference = 1`)
	]);
	return { tags, sites, total: Number(total) };
}
