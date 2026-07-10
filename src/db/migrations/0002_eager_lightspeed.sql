PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plan_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`task_ref` text NOT NULL,
	`start_at` text,
	`end_at` text,
	`lane` text NOT NULL,
	`seq` integer NOT NULL,
	`schedula_event_id` text,
	`confidence` real NOT NULL,
	`is_human_gate` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_plan_entry`("id", "plan_id", "task_ref", "start_at", "end_at", "lane", "seq", "schedula_event_id", "confidence", "is_human_gate") SELECT "id", "plan_id", "task_ref", "start_at", "end_at", "lane", "seq", "schedula_event_id", "confidence", "is_human_gate" FROM `plan_entry`;--> statement-breakpoint
DROP TABLE `plan_entry`;--> statement-breakpoint
ALTER TABLE `__new_plan_entry` RENAME TO `plan_entry`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_plan_entry_plan` ON `plan_entry` (`plan_id`);--> statement-breakpoint
ALTER TABLE `priority` ADD `first_ready_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_priority_scope_ref` ON `priority` (`scope`,`ref`);--> statement-breakpoint
CREATE INDEX `idx_plan_status` ON `plan` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_velocity_window` ON `velocity` (`project_ref`,`category`,`window_start`,`window_end`);--> statement-breakpoint
CREATE INDEX `idx_velocity_latest` ON `velocity` (`project_ref`,`category`,`window_end`);