CREATE TABLE `minna_fireworks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`generation` integer NOT NULL,
	`client_id` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`color` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `minna_fireworks_generation_created_idx` ON `minna_fireworks` (`generation`,`created_at`);