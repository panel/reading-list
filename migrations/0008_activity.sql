CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target_id` text,
	`summary` text NOT NULL,
	`undo` text,
	`undone_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_user_created` ON `activity` (`user_id`,`created_at`);