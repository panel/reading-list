CREATE TABLE `ai_usage` (
	`day` text PRIMARY KEY NOT NULL,
	`neurons` integer DEFAULT 0 NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL
);
