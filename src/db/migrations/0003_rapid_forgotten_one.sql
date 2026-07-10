CREATE TABLE `goal_risk_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_ref` text NOT NULL,
	`date` text NOT NULL,
	`projected_completion` text NOT NULL,
	`deadline` text NOT NULL,
	`level` text NOT NULL,
	`factors` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_goal_risk_snapshot_day` ON `goal_risk_snapshot` (`goal_ref`,`date`);--> statement-breakpoint
CREATE INDEX `idx_goal_risk_latest` ON `goal_risk_snapshot` (`goal_ref`,`date`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_curve_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`sprint_id` text NOT NULL,
	`date` text NOT NULL,
	`gompertz_params` text NOT NULL,
	`inflow_lambda` real NOT NULL,
	`burndown_actual` real NOT NULL,
	`burndown_planned` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprint`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_curve_snapshot`("id", "sprint_id", "date", "gompertz_params", "inflow_lambda", "burndown_actual", "burndown_planned", "created_at") SELECT "id", "sprint_id", "date", "gompertz_params", "inflow_lambda", "burndown_actual", "burndown_planned", CURRENT_TIMESTAMP FROM `curve_snapshot`;--> statement-breakpoint
DROP TABLE `curve_snapshot`;--> statement-breakpoint
ALTER TABLE `__new_curve_snapshot` RENAME TO `curve_snapshot`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_curve_snapshot_day` ON `curve_snapshot` (`sprint_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_curve_snapshot_sprint` ON `curve_snapshot` (`sprint_id`,`date`);--> statement-breakpoint
CREATE TABLE `__new_sprint_task` (
	`id` text PRIMARY KEY NOT NULL,
	`sprint_id` text NOT NULL,
	`task_ref` text NOT NULL,
	`effort_minutes` integer DEFAULT 0 NOT NULL,
	`priority_score` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'committed' NOT NULL,
	`status_history` text NOT NULL,
	`committed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprint`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sprint_task`("id", "sprint_id", "task_ref", "effort_minutes", "priority_score", "status", "status_history", "committed_at", "completed_at") SELECT "id", "sprint_id", "task_ref", 0, 0, 'committed', "status_history", CURRENT_TIMESTAMP, NULL FROM `sprint_task`;--> statement-breakpoint
DROP TABLE `sprint_task`;--> statement-breakpoint
ALTER TABLE `__new_sprint_task` RENAME TO `sprint_task`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sprint_task` ON `sprint_task` (`sprint_id`,`task_ref`);--> statement-breakpoint
CREATE INDEX `idx_sprint_task_status` ON `sprint_task` (`sprint_id`,`status`);--> statement-breakpoint
CREATE TABLE `__new_sprint` (
	`id` text PRIMARY KEY NOT NULL,
	`project_ref` text NOT NULL,
	`goal_ref` text,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`target_velocity` real NOT NULL,
	`gompertz_snapshot` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`closed_at` text
);--> statement-breakpoint
INSERT INTO `__new_sprint`("id", "project_ref", "goal_ref", "period_start", "period_end", "target_velocity", "gompertz_snapshot", "status", "created_at", "updated_at", "closed_at") SELECT "id", "project_ref", "goal_ref", "period_start", "period_end", "target_velocity", "gompertz_snapshot", "status", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL FROM `sprint`;--> statement-breakpoint
DROP TABLE `sprint`;--> statement-breakpoint
ALTER TABLE `__new_sprint` RENAME TO `sprint`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_sprint_project_status` ON `sprint` (`project_ref`,`status`);--> statement-breakpoint
CREATE INDEX `idx_sprint_period` ON `sprint` (`period_start`,`period_end`);
