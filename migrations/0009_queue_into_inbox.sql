-- Slice 10: the queue becomes the "Shared" feed in the inbox. Hand-written: data only.
--
-- Feed posts no longer get queued. A post that was queued from its feed goes back
-- to being an unread post, and its queue copy goes away. The copy is kept (and
-- archived) when it holds something of yours: a star, a note or tags. If the post
-- itself has been pruned, the link stays queued and shows up under Shared.
UPDATE `entry_state` SET `read_at` = NULL, `dismissed_at` = NULL
WHERE EXISTS (
	SELECT 1 FROM `links` l
	WHERE l.`user_id` = `entry_state`.`user_id`
		AND l.`source_entry_id` = `entry_state`.`entry_id`
		AND l.`status` = 'queued' AND l.`source` = 'feed'
);
--> statement-breakpoint
DELETE FROM `links`
WHERE `status` = 'queued' AND `source` = 'feed'
	AND `is_reference` = 0 AND `note` IS NULL
	AND NOT EXISTS (SELECT 1 FROM `link_tags` lt WHERE lt.`link_id` = `links`.`id`)
	AND EXISTS (SELECT 1 FROM `feed_entries` fe WHERE fe.`id` = `links`.`source_entry_id`);
--> statement-breakpoint
UPDATE `links`
SET `status` = 'archived',
	`read_at` = coalesce(`read_at`, unixepoch('subsec') * 1000),
	`updated_at` = unixepoch('subsec') * 1000
WHERE `status` = 'queued' AND `source` = 'feed'
	AND EXISTS (SELECT 1 FROM `feed_entries` fe WHERE fe.`id` = `links`.`source_entry_id`);
