CREATE TABLE `link_archives` (
	`link_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text,
	`html` text,
	`text` text,
	`words` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`claimed_at` integer,
	`captured_at` integer,
	`keep_until` integer,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "link_archives_status" CHECK("link_archives"."status" IN ('pending', 'fetching', 'ready', 'failed')),
	CONSTRAINT "link_archives_source" CHECK("link_archives"."source" IN ('page', 'feed'))
);
--> statement-breakpoint
CREATE INDEX `link_archives_status` ON `link_archives` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `link_archives_keep_until` ON `link_archives` (`keep_until`);--> statement-breakpoint
-- Hand-written below: triggers and the search index, which Drizzle can't model.
--
-- Every link that needs a readable copy gets a row: links in the inbox
-- (status 'queued') and starred links. keep_until is null while the link is
-- either; when it becomes Done and not starred, the copy is kept for 14 days
-- from then (the nightly prune deletes it after that).
CREATE TRIGGER `link_archives_on_insert` AFTER INSERT ON `links` BEGIN
	INSERT OR IGNORE INTO link_archives (link_id, keep_until)
	VALUES (
		new.id,
		CASE WHEN new.status = 'queued' OR new.is_reference THEN NULL
			ELSE unixepoch('subsec') * 1000 + 1209600000 END
	);
END;
--> statement-breakpoint
-- Back in the inbox or starred: keep the copy, re-create it if it was pruned,
-- and give a failed capture another go.
CREATE TRIGGER `link_archives_keep` AFTER UPDATE OF status, is_reference ON `links`
WHEN new.status = 'queued' OR new.is_reference
BEGIN
	INSERT OR IGNORE INTO link_archives (link_id) VALUES (new.id);
	UPDATE link_archives
	SET keep_until = NULL,
		status = CASE WHEN status = 'failed' AND NOT (old.status = 'queued' OR old.is_reference)
			THEN 'pending' ELSE status END,
		attempts = CASE WHEN status = 'failed' AND NOT (old.status = 'queued' OR old.is_reference)
			THEN 0 ELSE attempts END
	WHERE link_id = new.id;
END;
--> statement-breakpoint
-- Done and not starred (just finished, or unstarred after finishing): 14 days.
CREATE TRIGGER `link_archives_expire` AFTER UPDATE OF status, is_reference ON `links`
WHEN new.status <> 'queued' AND NOT new.is_reference AND (old.status = 'queued' OR old.is_reference)
BEGIN
	UPDATE link_archives SET keep_until = unixepoch('subsec') * 1000 + 1209600000
	WHERE link_id = new.id;
END;
--> statement-breakpoint
-- Existing links that need a copy; the fetcher works through them.
INSERT OR IGNORE INTO link_archives (link_id)
SELECT id FROM links WHERE status = 'queued' OR is_reference = 1;
--> statement-breakpoint
-- The search index gains a `body` column: the article text of starred links
-- (references), so the library is searchable by what articles say. FTS5 can't
-- add a column, so the table and its triggers are rebuilt.
DROP TRIGGER `links_fts_insert`;
--> statement-breakpoint
DROP TRIGGER `links_fts_update`;
--> statement-breakpoint
DROP TRIGGER `links_fts_delete`;
--> statement-breakpoint
DROP TRIGGER `links_fts_tag_insert`;
--> statement-breakpoint
DROP TRIGGER `links_fts_tag_delete`;
--> statement-breakpoint
DROP TABLE `links_fts`;
--> statement-breakpoint
CREATE VIRTUAL TABLE `links_fts` USING fts5(
	title,
	description,
	note,
	tags,
	site,
	author,
	url,
	body,
	tokenize = 'porter unicode61 remove_diacritics 2'
);
--> statement-breakpoint
INSERT INTO `links_fts` (rowid, title, description, note, tags, site, author, url, body)
SELECT
	l.rowid, l.title, l.description, l.note,
	(SELECT group_concat(t.name, ' ') FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = l.id),
	l.site_name, l.author, l.canonical_url, ''
FROM links l;
--> statement-breakpoint
CREATE TRIGGER `links_fts_insert` AFTER INSERT ON `links` BEGIN
	INSERT INTO links_fts (rowid, title, description, note, tags, site, author, url, body)
	VALUES (new.rowid, new.title, new.description, new.note, '', new.site_name, new.author, new.canonical_url, '');
END;
--> statement-breakpoint
CREATE TRIGGER `links_fts_update` AFTER UPDATE OF title, description, note, site_name, author, canonical_url, is_reference ON `links` BEGIN
	UPDATE links_fts
	SET title = new.title, description = new.description, note = new.note,
		site = new.site_name, author = new.author, url = new.canonical_url,
		body = CASE WHEN new.is_reference
			THEN coalesce((SELECT text FROM link_archives WHERE link_id = new.id AND status = 'ready'), '')
			ELSE '' END
	WHERE rowid = new.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `links_fts_delete` AFTER DELETE ON `links` BEGIN
	DELETE FROM links_fts WHERE rowid = old.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `links_fts_tag_insert` AFTER INSERT ON `link_tags` BEGIN
	UPDATE links_fts
	SET tags = (SELECT group_concat(t.name, ' ') FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = new.link_id)
	WHERE rowid = (SELECT rowid FROM links WHERE id = new.link_id);
END;
--> statement-breakpoint
CREATE TRIGGER `links_fts_tag_delete` AFTER DELETE ON `link_tags` BEGIN
	UPDATE links_fts
	SET tags = coalesce((SELECT group_concat(t.name, ' ') FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = old.link_id), '')
	WHERE rowid = (SELECT rowid FROM links WHERE id = old.link_id);
END;
--> statement-breakpoint
-- A copy becoming ready (or changing) updates a starred link's indexed text.
CREATE TRIGGER `links_fts_archive_insert` AFTER INSERT ON `link_archives` BEGIN
	UPDATE links_fts
	SET body = CASE WHEN new.status = 'ready' AND (SELECT is_reference FROM links WHERE id = new.link_id)
		THEN coalesce(new.text, '') ELSE '' END
	WHERE rowid = (SELECT rowid FROM links WHERE id = new.link_id);
END;
--> statement-breakpoint
CREATE TRIGGER `links_fts_archive_update` AFTER UPDATE OF status, text ON `link_archives` BEGIN
	UPDATE links_fts
	SET body = CASE WHEN new.status = 'ready' AND (SELECT is_reference FROM links WHERE id = new.link_id)
		THEN coalesce(new.text, '') ELSE '' END
	WHERE rowid = (SELECT rowid FROM links WHERE id = new.link_id);
END;
--> statement-breakpoint
CREATE TRIGGER `links_fts_archive_delete` AFTER DELETE ON `link_archives` BEGIN
	UPDATE links_fts SET body = ''
	WHERE rowid = (SELECT rowid FROM links WHERE id = old.link_id);
END;
