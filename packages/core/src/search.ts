export type SearchIs = 'ref' | 'queued' | 'archived' | 'unread';

export interface SearchQuery {
	/** Words and "quoted phrases" to match in the full-text index. */
	terms: string[];
	phrases: string[];
	/** Words prefixed with - that must not match. */
	excluded: string[];
	tags: string[];
	sites: string[];
	is: SearchIs[];
}

const IS_VALUES: Record<string, SearchIs> = {
	ref: 'ref',
	reference: 'ref',
	starred: 'ref',
	queued: 'queued',
	queue: 'queued',
	archived: 'archived',
	finished: 'archived',
	done: 'archived'
};

/**
 * Parses search input like `boring tech tag:architecture site:mcfunley.com is:ref
 * "innovation tokens" -rewrite` into full-text terms and structured filters.
 * Unknown `key:value` pairs are treated as ordinary words.
 */
export function parseSearch(input: string): SearchQuery {
	const query: SearchQuery = { terms: [], phrases: [], excluded: [], tags: [], sites: [], is: [] };
	const pattern = /(-?)"([^"]*)"|(\S+)/g;
	for (const match of input.matchAll(pattern)) {
		const [, negated, phrase, word] = match;
		if (phrase !== undefined) {
			const cleaned = phrase.trim();
			if (cleaned) (negated ? query.excluded : query.phrases).push(cleaned);
			continue;
		}
		const filter = word.match(/^(tag|site|is):(.+)$/i);
		if (filter) {
			const key = filter[1].toLowerCase();
			const value = filter[2].toLowerCase();
			if (key === 'tag') query.tags.push(value.replace(/^#/, ''));
			else if (key === 'site')
				query.sites.push(
					value
						.replace(/^https?:\/\//, '')
						.replace(/^www\./, '')
						.replace(/\/.*$/, '')
				);
			else if (IS_VALUES[value]) query.is.push(IS_VALUES[value]);
			continue;
		}
		if (word.startsWith('#') && word.length > 1) {
			query.tags.push(word.slice(1).toLowerCase());
			continue;
		}
		if (word.startsWith('-') && word.length > 1) {
			query.excluded.push(word.slice(1));
			continue;
		}
		query.terms.push(word);
	}
	query.tags = [...new Set(query.tags)];
	query.sites = [...new Set(query.sites)];
	query.is = [...new Set(query.is)];
	return query;
}

/** A value safe to use as one FTS5 string token ("" doubles an embedded quote). */
const ftsString = (value: string) => `"${value.replace(/"/g, '""')}"`;

/**
 * Builds an FTS5 MATCH expression, or null when the query has no text.
 * Words match as prefixes (so the palette finds results while typing),
 * phrases match exactly, and excluded words use NOT.
 */
export function toFtsMatch(query: SearchQuery): string | null {
	const positive = [
		...query.terms
			.map((t) => t.replace(/[^\p{L}\p{N}_'’.-]+/gu, ' ').trim())
			.flatMap((t) => t.split(/\s+/))
			.filter(Boolean)
			.map((t) => `${ftsString(t)}*`),
		...query.phrases.map(ftsString)
	];
	if (positive.length === 0) return null;
	const negative = query.excluded.map(ftsString);
	return [positive.join(' '), ...negative.map((n) => `NOT ${n}`)].join(' ');
}

/** Whether the query asks for anything at all. */
export const isEmptySearch = (q: SearchQuery) =>
	!q.terms.length && !q.phrases.length && !q.tags.length && !q.sites.length && !q.is.length;
