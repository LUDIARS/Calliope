import { relations } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const plan = sqliteTable('plan', {
  id: text('id').primaryKey(),
  goalRef: text('goal_ref'),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  status: text('status', { enum: ['draft', 'active', 'superseded'] }).notNull().default('draft'),
  velocitySnapshot: text('velocity_snapshot', { mode: 'json' }).$type<unknown>().notNull(),
  createdAt: text('created_at').notNull(),
  supersededBy: text('superseded_by'),
});

export const planEntry = sqliteTable('plan_entry', {
  id: text('id').primaryKey(),
  planId: text('plan_id').notNull().references(() => plan.id),
  taskRef: text('task_ref', { mode: 'json' }).$type<unknown>().notNull(),
  startAt: text('start_at').notNull(),
  endAt: text('end_at').notNull(),
  lane: text('lane').notNull(),
  seq: integer('seq').notNull(),
  schedulaEventId: text('schedula_event_id'),
  confidence: real('confidence').notNull(),
  isHumanGate: integer('is_human_gate', { mode: 'boolean' }).notNull().default(false),
});

export const sprint = sqliteTable('sprint', {
  id: text('id').primaryKey(),
  projectRef: text('project_ref').notNull(),
  goalRef: text('goal_ref'),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  targetVelocity: real('target_velocity').notNull(),
  gompertzSnapshot: text('gompertz_snapshot', { mode: 'json' }).$type<unknown>().notNull(),
  status: text('status', { enum: ['planned', 'active', 'closed'] }).notNull().default('planned'),
});

export const sprintTask = sqliteTable('sprint_task', {
  id: text('id').primaryKey(),
  sprintId: text('sprint_id').notNull().references(() => sprint.id),
  taskRef: text('task_ref', { mode: 'json' }).$type<unknown>().notNull(),
  statusHistory: text('status_history', { mode: 'json' }).$type<unknown>().notNull(),
});

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
});

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
});

export const priority = sqliteTable('priority', {
  id: text('id').primaryKey(),
  scope: text('scope', { enum: ['project', 'goal', 'task'] }).notNull(),
  ref: text('ref').notNull(),
  resolvedScore: real('resolved_score').notNull(),
  breakdown: text('breakdown', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const curveSnapshot = sqliteTable('curve_snapshot', {
  id: text('id').primaryKey(),
  sprintId: text('sprint_id').notNull().references(() => sprint.id),
  date: text('date').notNull(),
  gompertzParams: text('gompertz_params', { mode: 'json' }).$type<unknown>().notNull(),
  inflowLambda: real('inflow_lambda').notNull(),
  burndownActual: real('burndown_actual').notNull(),
  burndownPlanned: real('burndown_planned').notNull(),
});

export const calendarLink = sqliteTable('calendar_link', {
  id: text('id').primaryKey(),
  googleCalendarId: text('google_calendar_id').notNull(),
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
