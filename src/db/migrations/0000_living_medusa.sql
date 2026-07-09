CREATE TABLE `calendar_link` (
	`id` text PRIMARY KEY NOT NULL,
	`google_calendar_id` text NOT NULL,
	`sync_direction` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connector_state` (
	`service` text PRIMARY KEY NOT NULL,
	`health` text DEFAULT 'unknown' NOT NULL,
	`last_sync_at` text,
	`cursor` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `curve_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`sprint_id` text NOT NULL,
	`date` text NOT NULL,
	`gompertz_params` text NOT NULL,
	`inflow_lambda` real NOT NULL,
	`burndown_actual` real NOT NULL,
	`burndown_planned` real NOT NULL,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprint`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plan` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_ref` text,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`velocity_snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	`superseded_by` text
);
--> statement-breakpoint
CREATE TABLE `plan_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`task_ref` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`lane` text NOT NULL,
	`seq` integer NOT NULL,
	`schedula_event_id` text,
	`confidence` real NOT NULL,
	`is_human_gate` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plan`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `priority` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`ref` text NOT NULL,
	`resolved_score` real NOT NULL,
	`breakdown` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reschedule_log` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`applied_by` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sprint` (
	`id` text PRIMARY KEY NOT NULL,
	`project_ref` text NOT NULL,
	`goal_ref` text,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`target_velocity` real NOT NULL,
	`gompertz_snapshot` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sprint_task` (
	`id` text PRIMARY KEY NOT NULL,
	`sprint_id` text NOT NULL,
	`task_ref` text NOT NULL,
	`status_history` text NOT NULL,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprint`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_estimate` (
	`task_ref` text PRIMARY KEY NOT NULL,
	`effort_minutes` integer NOT NULL,
	`estimate_source` text NOT NULL,
	`confidence` real NOT NULL,
	`estimated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `velocity` (
	`id` text PRIMARY KEY NOT NULL,
	`project_ref` text NOT NULL,
	`category` text NOT NULL,
	`window_start` text NOT NULL,
	`window_end` text NOT NULL,
	`k_factor` real NOT NULL,
	`throughput` real NOT NULL,
	`distribution` text NOT NULL,
	`sample_size` integer NOT NULL,
	`source` text NOT NULL
);
