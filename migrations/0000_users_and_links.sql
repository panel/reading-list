CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text,
	`site_name` text,
	`author` text,
	`description` text,
	`image_url` text,
	`note` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`is_reference` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_entry_id` text,
	`saved_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`read_at` integer,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "links_status" CHECK("links"."status" IN ('queued', 'archived')),
	CONSTRAINT "links_source" CHECK("links"."source" IN ('manual', 'feed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `links_user_canonical_url` ON `links` (`user_id`,`canonical_url`);--> statement-breakpoint
CREATE INDEX `links_user_status_saved` ON `links` (`user_id`,`status`,`saved_at`);--> statement-breakpoint
CREATE INDEX `links_user_reference` ON `links` (`user_id`,`is_reference`,`saved_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);