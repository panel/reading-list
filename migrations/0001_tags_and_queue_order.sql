CREATE TABLE `link_tags` (
	`link_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`link_id`, `tag_id`),
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `link_tags_tag` ON `link_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_user_name` ON `tags` (`user_id`,`name`);--> statement-breakpoint
DROP INDEX `links_user_status_saved`;--> statement-breakpoint
ALTER TABLE `links` ADD `favicon_url` text;--> statement-breakpoint
ALTER TABLE `links` ADD `queued_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Existing links keep their place in the queue.
UPDATE `links` SET `queued_at` = `saved_at`;--> statement-breakpoint
CREATE INDEX `links_user_status_queued` ON `links` (`user_id`,`status`,`queued_at`);