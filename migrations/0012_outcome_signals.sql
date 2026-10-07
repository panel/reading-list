CREATE TABLE `entry_history` (
	`user_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`feed_id` text NOT NULL,
	`url` text,
	`title` text,
	`author` text,
	`published_at` integer,
	`read_at` integer,
	`opened_at` integer,
	`cited_at` integer,
	`dismissed_at` integer,
	`pruned_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `entry_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_history_user_feed` ON `entry_history` (`user_id`,`feed_id`);--> statement-breakpoint
ALTER TABLE `entry_state` ADD `opened_at` integer;--> statement-breakpoint
ALTER TABLE `entry_state` ADD `cited_at` integer;--> statement-breakpoint
ALTER TABLE `links` ADD `opened_at` integer;--> statement-breakpoint
ALTER TABLE `links` ADD `cited_at` integer;--> statement-breakpoint
ALTER TABLE `links` ADD `cite_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Best guess at which posts read so far were actually opened: read_at is also set
-- by Done (at the same moment as dismissed_at) and by a new feed's backlog (when
-- the post arrived or the feed was followed), so those are left out.
UPDATE `entry_state` SET `opened_at` = `read_at`
WHERE `read_at` IS NOT NULL
	AND (`dismissed_at` IS NULL OR `dismissed_at` - `read_at` > 1000)
	AND `read_at` - (SELECT `created_at` FROM `feed_entries` WHERE `id` = `entry_state`.`entry_id`) > 60000
	AND `read_at` - coalesce((
		SELECT s.`created_at` FROM `subscriptions` s
		JOIN `feed_entries` fe ON fe.`feed_id` = s.`feed_id`
		WHERE fe.`id` = `entry_state`.`entry_id` AND s.`user_id` = `entry_state`.`user_id`
	), 0) > 60000;
