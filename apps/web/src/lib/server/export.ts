import { desc, eq } from 'drizzle-orm';
import { links, type Db } from '@reading-list/core/db';
import { withTags } from './links';

/** Every link the user has, newest first, in a stable export shape. */
export async function exportLinks(db: Db, userId: string) {
	const rows = await db
		.select()
		.from(links)
		.where(eq(links.userId, userId))
		.orderBy(desc(links.savedAt));
	const withTagList = await withTags(db, rows);
	return withTagList.map((l) => ({
		url: l.url,
		title: l.title,
		site: l.siteName,
		author: l.author,
		description: l.description,
		note: l.note,
		tags: l.tags,
		status: l.status,
		reference: l.isReference,
		source: l.source,
		savedAt: l.savedAt.toISOString(),
		readAt: l.readAt?.toISOString() ?? null,
		starredAt: l.starredAt?.toISOString() ?? null
	}));
}

export type ExportedLink = Awaited<ReturnType<typeof exportLinks>>[number];

/**
 * One CSV cell: quoted when needed, and prefixed with ' when it would start
 * with a formula character, so spreadsheets don't execute saved page titles.
 */
export function csvCell(value: unknown): string {
	if (value === null || value === undefined) return '';
	let text = Array.isArray(value) ? value.join(' ') : String(value);
	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: ExportedLink[]): string {
	const columns: (keyof ExportedLink)[] = [
		'url',
		'title',
		'site',
		'author',
		'note',
		'tags',
		'status',
		'reference',
		'source',
		'savedAt',
		'readAt',
		'starredAt',
		'description'
	];
	const lines = [
		columns.join(','),
		...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))
	];
	return `${lines.join('\r\n')}\r\n`;
}
