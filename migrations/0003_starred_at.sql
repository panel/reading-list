ALTER TABLE `links` ADD `starred_at` integer;--> statement-breakpoint
-- Links already marked as references keep an order.
UPDATE `links` SET `starred_at` = `updated_at` WHERE `is_reference` = 1;
