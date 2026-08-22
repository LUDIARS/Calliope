import { relations, sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const plan = sqliteTable('plan', {
  id: text('id').primaryKey(),
  goalRef: text('goal_ref'),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  status: text('status', { enum: ['draft', 'active', 'superseded'] }).notNull().default('draft'),
  velocitySnapshot: text('velocity_snapshot', { mode: 'json' }).$type<unknown>().notNull(),
  createdAt: text('created_at').notNull(),
  supersededBy: text('superseded_by'),
}, (table) => [
  index('idx_plan_status').on(table.status),
]);

export const planEntry = sqliteTable('plan_entry', {
  id: text('id').primaryKey(),
  planId: text('plan_id').notNull().references(() => plan.id, { onDelete: 'cascade' }),
  taskRef: text('task_ref').notNull(),
  startAt: text('start_at'),
  endAt: text('end_at'),
  lane: text('lane').notNull(),
  seq: integer('seq').notNull(),
  schedulaEventId: text('schedula_event_id'),
  confidence: real('confidence').notNull(),
  isHumanGate: integer('is_human_gate', { mode: 'boolean' }).notNull().default(false),
}, (table) => [
  index('idx_plan_entry_plan').on(table.planId),
]);

export const sprint = sqliteTable('sprint', {
  id: text('id').primaryKey(),
  projectRef: text('project_ref').notNull(),
  goalRef: text('goal_ref'),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  targetVelocity: real('target_velocity').notNull(),
  gompertzSnapshot: text('gompertz_snapshot', { mode: 'json' }).$type<unknown>().notNull(),
  status: text('status', { enum: ['planned', 'active', 'closed'] }).notNull().default('planned'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  closedAt: text('closed_at'),
}, (table) => [
  index('idx_sprint_project_status').on(table.projectRef, table.status),
  index('idx_sprint_period').on(table.periodStart, table.periodEnd),
]);

export const sprintTask = sqliteTable('sprint_task', {
  id: text('id').primaryKey(),
  sprintId: text('sprint_id').notNull().references(() => sprint.id, { onDelete: 'cascade' }),
  taskRef: text('task_ref').notNull(),
  effortMinutes: integer('effort_minutes').notNull().default(0),
  priorityScore: real('priority_score').notNull().default(0),
  status: text('status', { enum: ['committed', 'completed', 'removed'] }).notNull().default('committed'),
  statusHistory: text('status_history', { mode: 'json' }).$type<unknown>().notNull(),
  committedAt: text('committed_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: text('completed_at'),
}, (table) => [
  uniqueIndex('uq_sprint_task').on(table.sprintId, table.taskRef),
  index('idx_sprint_task_status').on(table.sprintId, table.status),
]);

export const velocity = sqliteTable('velocity', {
  id: text('id').primaryKey(),
  projectRef: text('project_ref').notNull(),
  category: text('category').notNull(),
  windowStart: text('window_start').notNull(),
  windowEnd: text('window_end').notNull(),
  kFactor: real('k_factor').notNull(),
  throughput: real('throughput').notNull(),
  distribution: text('distribution', { mode: 'json' }).$type<unknown>().notNull(),
  sampleSize: integer('sample_size').notNull(),
  source: text('source').notNull(),
}, (table) => [
  uniqueIndex('uq_velocity_window').on(table.projectRef, table.category, table.windowStart, table.windowEnd),
  index('idx_velocity_latest').on(table.projectRef, table.category, table.windowEnd),
]);

export const taskEstimate = sqliteTable('task_estimate', {
  taskRef: text('task_ref').primaryKey(),
  effortMinutes: integer('effort_minutes').notNull(),
  estimateSource: text('estimate_source', { enum: ['human', 'analogy', 'llm'] }).notNull(),
  confidence: real('confidence').notNull(),
  estimatedAt: text('estimated_at').notNull(),
});

export const rescheduleLog = sqliteTable('reschedule_log', {
  id: text('id').primaryKey(),
  trigger: text('trigger').notNull(),
  before: text('before', { mode: 'json' }).$type<unknown>().notNull(),
  after: text('after', { mode: 'json' }).$type<unknown>().notNull(),
  appliedBy: text('applied_by', { enum: ['human', 'auto'] }).notNull(),
  reason: text('reason').notNull(),
  createdAt: text('created_at').notNull(),
  outcome: text('outcome', { enum: ['proposed', 'applied', 'rejected', 'expired'] }).notNull().default('applied'),
  confirmationId: text('confirmation_id'),
});

export const confirmation = sqliteTable('confirmation', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['plan_apply', 'reschedule', 'calendar_write', 'task_stocktake'] }).notNull(),
  payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),
  status: text('status', { enum: ['pending', 'approved', 'rejected', 'expired'] }).notNull().default('pending'),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  decidedAt: text('decided_at'),
  decidedBy: text('decided_by'),
  decisionReason: text('decision_reason'),
}, (table) => [
  index('idx_confirmation_status_expiry').on(table.status, table.expiresAt),
]);

export const priority = sqliteTable('priority', {
  id: text('id').primaryKey(),
  scope: text('scope', { enum: ['project', 'goal', 'task'] }).notNull(),
  ref: text('ref').notNull(),
  resolvedScore: real('resolved_score').notNull(),
  breakdown: text('breakdown', { mode: 'json' }).$type<unknown>().notNull(),
  firstReadyAt: text('first_ready_at'),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('uq_priority_scope_ref').on(table.scope, table.ref),
]);

export const curveSnapshot = sqliteTable('curve_snapshot', {
  id: text('id').primaryKey(),
  sprintId: text('sprint_id').notNull().references(() => sprint.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  gompertzParams: text('gompertz_params', { mode: 'json' }).$type<unknown>().notNull(),
  inflowLambda: real('inflow_lambda').notNull(),
  burndownActual: real('burndown_actual').notNull(),
  burndownPlanned: real('burndown_planned').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex('uq_curve_snapshot_day').on(table.sprintId, table.date),
  index('idx_curve_snapshot_sprint').on(table.sprintId, table.date),
]);

export const goalRiskSnapshot = sqliteTable('goal_risk_snapshot', {
  id: text('id').primaryKey(),
  goalRef: text('goal_ref').notNull(),
  date: text('date').notNull(),
  projectedCompletion: text('projected_completion').notNull(),
  deadline: text('deadline').notNull(),
  level: text('level', { enum: ['green', 'amber', 'red'] }).notNull(),
  factors: text('factors', { mode: 'json' }).$type<unknown>().notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex('uq_goal_risk_snapshot_day').on(table.goalRef, table.date),
  index('idx_goal_risk_latest').on(table.goalRef, table.date),
]);

export const calendarLink = sqliteTable('calendar_link', {
  id: text('id').primaryKey(),
  calendarRef: text('calendar_ref').notNull(),
  syncDirection: text('sync_direction', { enum: ['read', 'write', 'both'] }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  updatedAt: text('updated_at').notNull(),
});

export const connectorState = sqliteTable('connector_state', {
  service: text('service').primaryKey(),
  health: text('health').notNull().default('unknown'),
  lastSyncAt: text('last_sync_at'),
  cursor: text('cursor'),
  updatedAt: text('updated_at').notNull(),
});

/**
 * サービスマップ (Villa /map から移設): 家PC 台帳。
 * PC は割当先のノードであり個人データは持たない (スペック・置き場所・稼働方針のみ)。
 */
export const serviceMapPc = sqliteTable('service_map_pc', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  location: text('location').notNull().default(''),
  role: text('role').notNull().default(''),
  mode: text('mode').notNull().default('手動稼働'),
  priority: text('priority', { enum: ['S', 'A', 'B', 'C'] }).notNull().default('A'),
  os: text('os').notNull().default(''),
  cpu: text('cpu').notNull().default(''),
  ram: text('ram').notNull().default(''),
  gpu: text('gpu').notNull().default(''),
  storage: text('storage').notNull().default(''),
  note: text('note').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
});

/** 事業ドメイン: サービスグループを束ねてロードマップを生成する単位。 */
export const serviceMapDomain = sqliteTable('service_map_domain', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  note: text('note').notNull().default(''),
  seq: integer('seq').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

/** サービスグループ: PC 割当と事業ドメイン所属の単位 (Villa の group を継承)。 */
export const serviceMapGroup = sqliteTable('service_map_group', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  domainId: text('domain_id').references(() => serviceMapDomain.id, { onDelete: 'set null' }),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_service_map_group_domain').on(table.domainId),
]);

/**
 * サービス台帳。正本は Excubitor catalog で、ここは同期スナップショット + 割当。
 * groupIds / pcIds は複数所属を許す (Villa の workload 形を継承)。
 */
export const serviceMapService = sqliteTable('service_map_service', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  projectCode: text('project_code').notNull(),
  tier: text('tier').notNull().default('saas'),
  port: integer('port'),
  description: text('description').notNull().default(''),
  cadence: text('cadence').notNull().default('常時'),
  load: text('load', { enum: ['heavy', 'medium', 'light'] }).notNull().default('medium'),
  groupIds: text('group_ids', { mode: 'json' }).$type<string[]>().notNull(),
  pcIds: text('pc_ids', { mode: 'json' }).$type<string[]>().notNull(),
  runState: text('run_state').notNull().default('unknown'),
  /** 直近同期の catalog に存在したか。消えたサービスは false で残し、割当を失わない。 */
  inCatalog: integer('in_catalog', { mode: 'boolean' }).notNull().default(true),
  /** catalog 外で手動追加したサービス (同期で消さない)。 */
  manual: integer('manual', { mode: 'boolean' }).notNull().default(false),
  lastSyncedAt: text('last_synced_at'),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('uq_service_map_service_code').on(table.code),
]);

/** 事業ドメイン別ロードマップの生成スナップショット (supersede で版管理)。 */
export const serviceMapRoadmap = sqliteTable('service_map_roadmap', {
  id: text('id').primaryKey(),
  status: text('status', { enum: ['active', 'superseded'] }).notNull().default('active'),
  payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),
  generatedAt: text('generated_at').notNull(),
  supersededBy: text('superseded_by'),
}, (table) => [
  index('idx_service_map_roadmap_status').on(table.status),
]);

export const planRelations = relations(plan, ({ many }) => ({
  entries: many(planEntry),
}));

export const planEntryRelations = relations(planEntry, ({ one }) => ({
  plan: one(plan, {
    fields: [planEntry.planId],
    references: [plan.id],
  }),
}));

export const sprintRelations = relations(sprint, ({ many }) => ({
  tasks: many(sprintTask),
  curveSnapshots: many(curveSnapshot),
}));

export const sprintTaskRelations = relations(sprintTask, ({ one }) => ({
  sprint: one(sprint, {
    fields: [sprintTask.sprintId],
    references: [sprint.id],
  }),
}));

export const curveSnapshotRelations = relations(curveSnapshot, ({ one }) => ({
  sprint: one(sprint, {
    fields: [curveSnapshot.sprintId],
    references: [sprint.id],
  }),
}));
