CREATE TABLE `confirmation` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`decided_at` text,
	`decided_by` text,
	`decision_reason` text
);
--> statement-breakpoint
CREATE INDEX `idx_confirmation_status_expiry` ON `confirmation` (`status`,`expires_at`);--> statement-breakpoint
ALTER TABLE `reschedule_log` ADD `outcome` text DEFAULT 'applied' NOT NULL;--> statement-breakpoint
ALTER TABLE `reschedule_log` ADD `confirmation_id` text;