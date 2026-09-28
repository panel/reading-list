import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
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
		faviconUrl: text('favicon_url'),
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
		// Queue order: set when saved, bumped to now when you choose "Later".
		// The DB default is a constant because SQLite can't add a column with a
		// computed default to an existing table; the app always sets it.
		queuedAt: timestamp('queued_at')
			.notNull()
			.default(sql`0`)
			.$defaultFn(() => new Date()),
		readAt: timestamp('read_at'),
		updatedAt: timestampNow('updated_at')
	},
	(t) => [
		uniqueIndex('links_user_canonical_url').on(t.userId, t.canonicalUrl),
		index('links_user_status_queued').on(t.userId, t.status, t.queuedAt),
		index('links_user_reference').on(t.userId, t.isReference, t.savedAt),
		check('links_status', sql`${t.status} IN ('queued', 'archived')`),
		check('links_source', sql`${t.source} IN ('manual', 'feed')`)
	]
);

export const tags = sqliteTable(
	'tags',
	{
		id: id(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		createdAt: timestampNow('created_at')
	},
	(t) => [uniqueIndex('tags_user_name').on(t.userId, t.name)]
);

export const linkTags = sqliteTable(
	'link_tags',
	{
		linkId: text('link_id')
			.notNull()
			.references(() => links.id, { onDelete: 'cascade' }),
		tagId: text('tag_id')
			.notNull()
			.references(() => tags.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.linkId, t.tagId] }), index('link_tags_tag').on(t.tagId)]
);

/**
 * Bearer tokens for the JSON API (iOS Shortcuts, agents). Only a SHA-256 hash
 * is stored; the token itself is shown once, when it's created.
 */
export const apiTokens = sqliteTable(
	'api_tokens',
	{
		id: id(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		tokenHash: text('token_hash').notNull().unique(),
		// First characters of the token, so you can tell tokens apart in the list.
		tokenPrefix: text('token_prefix').notNull(),
		// Space-separated, e.g. "links:write". See apps/web/src/lib/server/tokens.ts.
		scopes: text('scopes').notNull(),
		lastUsedAt: timestamp('last_used_at'),
		createdAt: timestampNow('created_at')
	},
	(t) => [index('api_tokens_user').on(t.userId)]
);

export type User = typeof users.$inferSelect;
export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
