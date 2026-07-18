CREATE TABLE `minna_participants` (
	`secret_id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`color` text NOT NULL,
	`generation` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`answer_thanks` text,
	`answer_state` text,
	`hold_started_at` integer,
	`hold_completed` integer DEFAULT false NOT NULL,
	`finale_eligible` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `minna_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`phase` text DEFAULT 'lobby' NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`collective_line` text,
	`deadline_at` integer,
	`special` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `minna_sessions` (`id`, `phase`, `generation`, `special`, `updated_at`)
VALUES ('main', 'lobby', 1, 0, 0);
