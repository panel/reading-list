CREATE TABLE `highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_kind` text NOT NULL,
	`item_id` text NOT NULL,
	`text` text NOT NULL,
	`note` text,
	`block` integer DEFAULT 0 NOT NULL,
	`title` text,
	`url` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "highlights_item_kind" CHECK("highlights"."item_kind" IN ('post', 'link'))
);
--> statement-breakpoint
CREATE INDEX `highlights_user_item` ON `highlights` (`user_id`,`item_kind`,`item_id`);--> statement-breakpoint
CREATE INDEX `highlights_user_created` ON `highlights` (`user_id`,`created_at`);