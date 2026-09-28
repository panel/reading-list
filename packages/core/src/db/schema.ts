import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { ulid } from '../ulid';

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => ulid());

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

const timestampNow = (name: string) =>
	timestamp(name)
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`);

export const users = sqliteTable('users', {
	id: id(),
	email: text('email').notNull().unique(),
	createdAt: timestampNow('created_at')
});

export const links = sqliteTable(
	'links',
	{
		id: id(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		url: text('url').notNull(),
		canonicalUrl: text('canonical_url').notNull(),
		title: text('title'),
		siteName: text('site_name'),
		author: text('author'),
		description: text('description'),
		imageUrl: text('image_url'),
		note: text('note'),
		status: text('status', { enum: ['queued', 'archived'] })
			.notNull()
			.default('queued'),
		isReference: integer('is_reference', { mode: 'boolean' }).notNull().default(false),
		source: text('source', { enum: ['manual', 'feed'] })
			.notNull()
			.default('manual'),
		// Points at feed_entries.id once feeds exist (Slice 4); no FK so entries can be pruned.
		sourceEntryId: text('source_entry_id'),
		savedAt: timestampNow('saved_at'),
		readAt: timestamp('read_at'),
		updatedAt: timestampNow('updated_at')
	},
	(t) => [
		uniqueIndex('links_user_canonical_url').on(t.userId, t.canonicalUrl),
		index('links_user_status_saved').on(t.userId, t.status, t.savedAt),
		index('links_user_reference').on(t.userId, t.isReference, t.savedAt),
		check('links_status', sql`${t.status} IN ('queued', 'archived')`),
		check('links_source', sql`${t.source} IN ('manual', 'feed')`)
	]
);

export type User = typeof users.$inferSelect;
export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
