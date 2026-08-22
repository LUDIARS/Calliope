CREATE TABLE `service_map_domain` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_map_group` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `service_map_domain`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_service_map_group_domain` ON `service_map_group` (`domain_id`);--> statement-breakpoint
CREATE TABLE `service_map_pc` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`mode` text DEFAULT '手動稼働' NOT NULL,
	`priority` text DEFAULT 'A' NOT NULL,
	`os` text DEFAULT '' NOT NULL,
	`cpu` text DEFAULT '' NOT NULL,
	`ram` text DEFAULT '' NOT NULL,
	`gpu` text DEFAULT '' NOT NULL,
	`storage` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_map_roadmap` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`payload` text NOT NULL,
	`generated_at` text NOT NULL,
	`superseded_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_service_map_roadmap_status` ON `service_map_roadmap` (`status`);--> statement-breakpoint
CREATE TABLE `service_map_service` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`project_code` text NOT NULL,
	`tier` text DEFAULT 'saas' NOT NULL,
	`port` integer,
	`description` text DEFAULT '' NOT NULL,
	`cadence` text DEFAULT '常時' NOT NULL,
	`load` text DEFAULT 'medium' NOT NULL,
	`group_ids` text NOT NULL,
	`pc_ids` text NOT NULL,
	`run_state` text DEFAULT 'unknown' NOT NULL,
	`in_catalog` integer DEFAULT true NOT NULL,
	`manual` integer DEFAULT false NOT NULL,
	`last_synced_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_service_map_service_code` ON `service_map_service` (`code`);