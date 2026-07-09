import { eq } from 'drizzle-orm';
import type { CalliopeDb } from './client.ts';
import { connectorState, plan, velocity } from './schema.ts';

export type ConnectorHealth = 'ok' | 'down' | 'unconfigured' | 'unknown';

export interface ConnectorStateInput {
  service: string;
  health: ConnectorHealth;
  lastSyncAt?: string | null;
  cursor?: string | null;
  updatedAt: string;
}

export interface NewPlan {
  id: string;
  goalRef?: string | null;
  periodStart: string;
  periodEnd: string;
  status?: 'draft' | 'active' | 'superseded';
  velocitySnapshot: unknown;
  createdAt: string;
  supersededBy?: string | null;
}

export interface NewVelocity {
  id: string;
  projectRef: string;
  category: string;
  windowStart: string;
  windowEnd: string;
  kFactor: number;
  throughput: number;
  distribution: unknown;
  sampleSize: number;
  source: string;
}

export function makeRepository(db: CalliopeDb) {
  return {
    async upsertConnectorState(input: ConnectorStateInput) {
      await db
        .insert(connectorState)
        .values(input)
        .onConflictDoUpdate({
          target: connectorState.service,
          set: {
            health: input.health,
            lastSyncAt: input.lastSyncAt ?? null,
            cursor: input.cursor ?? null,
            updatedAt: input.updatedAt,
          },
        });
    },

    async getConnectorState(service: string) {
      const rows = await db.select().from(connectorState).where(eq(connectorState.service, service)).limit(1);
      return rows[0] ?? null;
    },

    async listConnectorStates() {
      return db.select().from(connectorState);
    },

    async createPlan(input: NewPlan) {
      await db.insert(plan).values({
        id: input.id,
        goalRef: input.goalRef ?? null,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: input.status ?? 'draft',
        velocitySnapshot: input.velocitySnapshot,
        createdAt: input.createdAt,
        supersededBy: input.supersededBy ?? null,
      });
    },

    async listPlans() {
      return db.select().from(plan);
    },

    async createVelocity(input: NewVelocity) {
      await db.insert(velocity).values(input);
    },

    async listVelocity() {
      return db.select().from(velocity);
    },
  };
}

export type CalliopeRepository = ReturnType<typeof makeRepository>;
