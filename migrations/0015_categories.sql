CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_slug` ON `categories` (`user_id`,`slug`);--> statement-breakpoint
CREATE TABLE `category_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`include_library` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `item_categories` (
	`user_id` text NOT NULL,
	`item_kind` text NOT NULL,
	`item_id` text NOT NULL,
	`primary_slug` text NOT NULL,
	`secondary_slug` text,
	`probabilities` text,
	`corrected` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `item_kind`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "item_categories_item_kind" CHECK("item_categories"."item_kind" IN ('post', 'link'))
);
--> statement-breakpoint
CREATE INDEX `item_categories_primary` ON `item_categories` (`user_id`,`primary_slug`);--> statement-breakpoint
CREATE INDEX `item_categories_secondary` ON `item_categories` (`user_id`,`secondary_slug`);