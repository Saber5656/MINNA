PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_minna_participants` (
	`secret_id` text NOT NULL,
	`session_id` text DEFAULT 'main' NOT NULL,
	`public_id` text NOT NULL,
	`color` text NOT NULL,
	`generation` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`answer_thanks` text,
	`answer_state` text,
	`answer_wish` text,
	`answer_role` text,
	`answer_energy` text,
	`hold_started_at` integer,
	`hold_completed` integer DEFAULT false NOT NULL,
	`finale_eligible` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`session_id`, `secret_id`)
);
--> statement-breakpoint
INSERT INTO `__new_minna_participants`("secret_id", "session_id", "public_id", "color", "generation", "last_seen", "answer_thanks", "answer_state", "answer_wish", "answer_role", "answer_energy", "hold_started_at", "hold_completed", "finale_eligible") SELECT "secret_id", "session_id", "public_id", "color", "generation", "last_seen", "answer_thanks", "answer_state", "answer_wish", "answer_role", "answer_energy", "hold_started_at", "hold_completed", "finale_eligible" FROM `minna_participants`;--> statement-breakpoint
DROP TABLE `minna_participants`;--> statement-breakpoint
ALTER TABLE `__new_minna_participants` RENAME TO `minna_participants`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `minna_session_generation_seen_idx` ON `minna_participants` (`session_id`,`generation`,`last_seen`);--> statement-breakpoint
CREATE TABLE `__new_minna_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`target_count` integer DEFAULT 0 NOT NULL,
	`phase` text DEFAULT 'lobby' NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`collective_line` text,
	`deadline_at` integer,
	`special` integer DEFAULT false NOT NULL,
	`room_code` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "minna_sessions_target_count_check" CHECK("target_count" >= 0 AND "target_count" <= 500)
);
--> statement-breakpoint
INSERT INTO `__new_minna_sessions`("id", "owner_id", "target_count", "phase", "generation", "collective_line", "deadline_at", "special", "room_code", "updated_at") SELECT "id", "owner_id", "target_count", "phase", "generation", "collective_line", "deadline_at", "special", "room_code", "updated_at" FROM `minna_sessions`;--> statement-breakpoint
DROP TABLE `minna_sessions`;--> statement-breakpoint
ALTER TABLE `__new_minna_sessions` RENAME TO `minna_sessions`;--> statement-breakpoint
CREATE UNIQUE INDEX `minna_sessions_owner_idx` ON `minna_sessions` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `minna_sessions_room_code_idx` ON `minna_sessions` (`room_code`);
