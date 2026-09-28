-- Full-text search over links (Slice 7). Hand-written: Drizzle can't model FTS5.
--
-- links_fts shares rowids with links, so lookups and deletes by rowid are cheap.
-- Triggers keep it in sync with links and with each link's tags.
CREATE VIRTUAL TABLE `links_fts` USING fts5(
	title,
	description,
	note,
	tags,
	site,
	author,
	url,
	tokenize = 'porter unicode61 remove_diacritics 2'
);
--> statement-breakpoint
INSERT INTO `links_fts` (rowid, title, description, note, tags, site, author, url)
SELECT
	l.rowid, l.title, l.description, l.note,
	(SELECT group_concat(t.name, ' ') FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = l.id),
	l.site_name, l.author, l.canonical_url
FROM links l;
--> statement-breakpoint
CREATE TRIGGER `links_fts_insert` AFTER INSERT ON `links` BEGIN
	INSERT INTO links_fts (rowid, title, description, note, tags, site, author, url)
	VALUES (new.rowid, new.title, new.description, new.note, '', new.site_name, new.author, new.canonical_url);
END;
--> statement-breakpoint
CREATE TRIGGER `links_fts_update` AFTER UPDATE OF title, description, note, site_name, author, canonical_url ON `links` BEGIN
	UPDATE links_fts
	SET title = new.title, description = new.description, note = new.note,
		site = new.site_name, author = new.author, url = new.canonical_url
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
