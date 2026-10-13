CREATE TABLE `reading_places` (
	`user_id` text NOT NULL,
	`item_kind` text NOT NULL,
	`item_id` text NOT NULL,
	`block` integer NOT NULL,
	`progress` real NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `item_kind`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reading_places_item_kind" CHECK("reading_places"."item_kind" IN ('post', 'link'))
);
--> statement-breakpoint
CREATE INDEX `reading_places_user_updated` ON `reading_places` (`user_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `feed_entries` ADD `words` integer;--> statement-breakpoint
-- Posts stored before now: estimate their words from the spaces in the content
-- (HTML attributes add a few). New posts are counted exactly when stored.
UPDATE `feed_entries` SET `words` =
	length(coalesce(`content`, `summary`, '')) - length(replace(coalesce(`content`, `summary`, ''), ' ', ''));
