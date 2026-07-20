DROP INDEX `minna_fireworks_generation_created_idx`;--> statement-breakpoint
ALTER TABLE `minna_fireworks` ADD `session_id` text DEFAULT 'main' NOT NULL;--> statement-breakpoint
CREATE INDEX `minna_fireworks_session_generation_created_idx` ON `minna_fireworks` (`session_id`,`generation`,`created_at`);--> statement-breakpoint
DROP INDEX `minna_generation_seen_idx`;--> statement-breakpoint
ALTER TABLE `minna_participants` ADD `session_id` text DEFAULT 'main' NOT NULL;--> statement-breakpoint
CREATE INDEX `minna_session_generation_seen_idx` ON `minna_participants` (`session_id`,`generation`,`last_seen`);--> statement-breakpoint
ALTER TABLE `minna_sessions` ADD `owner_id` text;--> statement-breakpoint
ALTER TABLE `minna_sessions` ADD `target_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `minna_sessions_owner_idx` ON `minna_sessions` (`owner_id`);