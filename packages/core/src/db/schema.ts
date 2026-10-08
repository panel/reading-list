import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	primaryKey,
	real,
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
		// When it was starred as a reference; orders the Library.
		starredAt: timestamp('starred_at'),
		// When it was first opened in the app (its link page), as opposed to read_at,
		// which Done sets whether or not it was opened. A signal for Slice 12's predictions.
		openedAt: timestamp('opened_at'),
		// Copying its URL (palette, Copy link): the clearest sign it's used as a reference.
		citedAt: timestamp('cited_at'),
		citeCount: integer('cite_count').notNull().default(0),
		updatedAt: timestampNow('updated_at')
	},
	(t) => [
		uniqueIndex('links_user_canonical_url').on(t.userId, t.canonicalUrl),
		index('links_user_status_queued').on(t.userId, t.status, t.queuedAt),
		index('links_user_reference').on(t.userId, t.isReference, t.savedAt),
		// Which feed posts a user has already saved or starred.
		index('links_user_source_entry').on(t.userId, t.sourceEntryId),
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
 * One row per feed URL, shared by everyone subscribed to it, so a popular
 * feed is fetched once however many people follow it.
 */
export const feeds = sqliteTable(
	'feeds',
	{
		id: id(),
		url: text('url').notNull().unique(),
		siteUrl: text('site_url'),
		title: text('title'),
		description: text('description'),
		// Conditional GET validators from the last successful fetch.
		etag: text('etag'),
		lastModified: text('last_modified'),
		lastFetchedAt: timestamp('last_fetched_at'),
		nextFetchAt: timestamp('next_fetch_at'),
		errorCount: integer('error_count').notNull().default(0),
		lastError: text('last_error'),
		createdAt: timestampNow('created_at')
	},
	(t) => [index('feeds_next_fetch').on(t.nextFetchAt)]
);

export const subscriptions = sqliteTable(
	'subscriptions',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		feedId: text('feed_id')
			.notNull()
			.references(() => feeds.id, { onDelete: 'cascade' }),
		titleOverride: text('title_override'),
		// Optional group for the feed in the inbox, e.g. "Tech". Imported from OPML folders.
		folder: text('folder'),
		createdAt: timestampNow('created_at')
	},
	(t) => [primaryKey({ columns: [t.userId, t.feedId] }), index('subscriptions_feed').on(t.feedId)]
);

export const feedEntries = sqliteTable(
	'feed_entries',
	{
		id: id(),
		feedId: text('feed_id')
			.notNull()
			.references(() => feeds.id, { onDelete: 'cascade' }),
		guid: text('guid').notNull(),
		url: text('url'),
		title: text('title'),
		author: text('author'),
		summary: text('summary'),
		// Raw HTML as published; sanitized when rendered.
		content: text('content'),
		imageUrl: text('image_url'),
		publishedAt: timestamp('published_at'),
		createdAt: timestampNow('created_at')
	},
	(t) => [
		uniqueIndex('feed_entries_feed_guid').on(t.feedId, t.guid),
		index('feed_entries_feed_published').on(t.feedId, t.publishedAt),
		// Finds the post behind a link shared in by hand (same URL).
		index('feed_entries_url').on(t.url)
	]
);

/**
 * Per-user read state for feed entries. No row = unread. read_at is "no longer
 * new" (opened, Done, or a new feed's backlog); opened_at is only set when the
 * post was actually opened in a reader.
 */
export const entryState = sqliteTable(
	'entry_state',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		entryId: text('entry_id')
			.notNull()
			.references(() => feedEntries.id, { onDelete: 'cascade' }),
		readAt: timestamp('read_at'),
		dismissedAt: timestamp('dismissed_at'),
		openedAt: timestamp('opened_at'),
		citedAt: timestamp('cited_at')
	},
	(t) => [primaryKey({ columns: [t.userId, t.entryId] })]
);

/**
 * What happened to posts the nightly prune removed, so the record of what was
 * opened and what was skipped outlives the posts (Slice 12). Only posts that
 * were opened, cited or dismissed are kept; no FKs, since the post is gone.
 */
export const entryHistory = sqliteTable(
	'entry_history',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		entryId: text('entry_id').notNull(),
		feedId: text('feed_id').notNull(),
		url: text('url'),
		title: text('title'),
		author: text('author'),
		publishedAt: timestamp('published_at'),
		readAt: timestamp('read_at'),
		openedAt: timestamp('opened_at'),
		citedAt: timestamp('cited_at'),
		dismissedAt: timestamp('dismissed_at'),
		prunedAt: timestampNow('pruned_at')
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.entryId] }),
		index('entry_history_user_feed').on(t.userId, t.feedId)
	]
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

/**
 * What API tokens (the Shortcut, agents) changed, so it can be reviewed and
 * undone from Settings. `undo` is a JSON description of how to reverse it.
 */
export const activity = sqliteTable(
	'activity',
	{
		id: id(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// Kept when a token is revoked, so history still says who did what.
		tokenId: text('token_id'),
		actor: text('actor').notNull(),
		action: text('action').notNull(),
		targetId: text('target_id'),
		summary: text('summary').notNull(),
		undo: text('undo'),
		undoneAt: timestamp('undone_at'),
		createdAt: timestampNow('created_at')
	},
	(t) => [index('activity_user_created').on(t.userId, t.createdAt)]
);

/**
 * A readable copy of a saved link's article (Slice 11), captured off the
 * request path by the fetcher. One row per link that needs a copy: links in
 * the inbox and starred links. Triggers on `links` (migration 0011) create the
 * row and set keep_until: null while the link is in the inbox or starred, and
 * Done + 14 days otherwise; the nightly prune deletes rows past keep_until.
 */
export const linkArchives = sqliteTable(
	'link_archives',
	{
		linkId: text('link_id')
			.primaryKey()
			.references(() => links.id, { onDelete: 'cascade' }),
		status: text('status', { enum: ['pending', 'fetching', 'ready', 'failed'] })
			.notNull()
			.default('pending'),
		// Where the copy came from: the page itself, or a feed post's content.
		source: text('source', { enum: ['page', 'feed'] }),
		html: text('html'),
		// Plain text: word count, and the search index for starred links.
		text: text('text'),
		words: integer('words'),
		attempts: integer('attempts').notNull().default(0),
		lastError: text('last_error'),
		claimedAt: timestamp('claimed_at'),
		capturedAt: timestamp('captured_at'),
		keepUntil: timestamp('keep_until'),
		updatedAt: timestampNow('updated_at')
	},
	(t) => [
		index('link_archives_status').on(t.status, t.updatedAt),
		index('link_archives_keep_until').on(t.keepUntil),
		check('link_archives_status', sql`${t.status} IN ('pending', 'fetching', 'ready', 'failed')`),
		check('link_archives_source', sql`${t.source} IN ('page', 'feed')`)
	]
);

/**
 * Neurons spent on Workers AI per UTC day, against the app's own daily cap
 * (AI_DAILY_NEURONS). Account-wide, like Workers AI's free allowance.
 */
export const aiUsage = sqliteTable('ai_usage', {
	day: text('day').primaryKey(),
	neurons: integer('neurons').notNull().default(0),
	calls: integer('calls').notNull().default(0)
});

/**
 * What a decision model predicted for an item in a user's inbox (Slice 12): the
 * chance they open it and the chance they star it. One row per item and model,
 * kept after the item is gone (no FK on the item), so predictions can be checked
 * against what actually happened. A failed call leaves `error` and is retried a
 * few times.
 */
export const predictions = sqliteTable(
	'predictions',
	{
		id: id(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		itemKind: text('item_kind', { enum: ['post', 'link'] }).notNull(),
		// feed_entries.id for a post, links.id for a link.
		itemId: text('item_id').notNull(),
		model: text('model').notNull(),
		pOpen: real('p_open'),
		pKeep: real('p_keep'),
		// The parsed answers as JSON, for questions added later (categories).
		answers: text('answers'),
		inputTokens: integer('input_tokens'),
		neurons: integer('neurons'),
		error: text('error'),
		attempts: integer('attempts').notNull().default(0),
		createdAt: timestampNow('created_at'),
		updatedAt: timestampNow('updated_at')
	},
	(t) => [
		uniqueIndex('predictions_item').on(t.userId, t.itemKind, t.itemId, t.model),
		check('predictions_item_kind', sql`${t.itemKind} IN ('post', 'link')`)
	]
);

/**
 * A user's categories (Slice 12d): a name, and a one-line description the
 * decision model uses as the rule for what belongs. The slug is the option id
 * sent to the model, so it must stay within the API's id characters. "other"
 * is implicit and never stored.
 */
export const categories = sqliteTable(
	'categories',
	{
		id: id(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		slug: text('slug').notNull(),
		name: text('name').notNull(),
		description: text('description').notNull(),
		position: integer('position').notNull().default(0),
		createdAt: timestampNow('created_at')
	},
	(t) => [uniqueIndex('categories_user_slug').on(t.userId, t.slug)]
);

/** Per-user category options. */
export const categorySettings = sqliteTable('category_settings', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	// Also categorize starred links (the Library), not just the inbox.
	includeLibrary: integer('include_library', { mode: 'boolean' }).notNull().default(false),
	updatedAt: timestampNow('updated_at')
});

/**
 * The category of an item in the inbox or Library: the model's top pick, a
 * second one when it's also likely, or the user's correction. Saving new
 * categories clears the model's rows, so items are categorized again. "other"
 * is a valid slug here. No FK on the item: posts get pruned.
 */
export const itemCategories = sqliteTable(
	'item_categories',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		itemKind: text('item_kind', { enum: ['post', 'link'] }).notNull(),
		itemId: text('item_id').notNull(),
		primarySlug: text('primary_slug').notNull(),
		secondarySlug: text('secondary_slug'),
		// The model's probability for each slug, as JSON; null for a correction.
		probabilities: text('probabilities'),
		// Set by the user (a correction), so it survives re-categorizing.
		corrected: integer('corrected', { mode: 'boolean' }).notNull().default(false),
		updatedAt: timestampNow('updated_at')
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.itemKind, t.itemId] }),
		index('item_categories_primary').on(t.userId, t.primarySlug),
		index('item_categories_secondary').on(t.userId, t.secondarySlug),
		check('item_categories_item_kind', sql`${t.itemKind} IN ('post', 'link')`)
	]
);

export type User = typeof users.$inferSelect;
export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type Activity = typeof activity.$inferSelect;
export type Feed = typeof feeds.$inferSelect;
export type FeedEntry = typeof feedEntries.$inferSelect;
export type EntryHistory = typeof entryHistory.$inferSelect;
export type LinkArchive = typeof linkArchives.$inferSelect;
export type Prediction = typeof predictions.$inferSelect;
export type Category = typeof categories.$inferSelect;
