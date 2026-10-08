CREATE TABLE `predictions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_kind` text NOT NULL,
	`item_id` text NOT NULL,
	`model` text NOT NULL,
	`p_open` real,
	`p_keep` real,
	`answers` text,
	`input_tokens` integer,
	`neurons` integer,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "predictions_item_kind" CHECK("predictions"."item_kind" IN ('post', 'link'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `predictions_item` ON `predictions` (`user_id`,`item_kind`,`item_id`,`model`);