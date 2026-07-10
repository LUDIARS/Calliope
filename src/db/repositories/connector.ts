import { eq } from 'drizzle-orm';
import type { CalliopeDb } from '../client.ts';
import { connectorState } from '../schema.ts';

export type ConnectorHealth = 'ok' | 'down' | 'unconfigured' | 'unknown';

export interface ConnectorStateInput {
  service: string;
  health: ConnectorHealth;
  lastSyncAt?: string | null;
  cursor?: string | null;
  updatedAt: string;
}

export function makeConnectorRepository(db: CalliopeDb) {
  return {
    async upsertConnectorState(input: ConnectorStateInput) {
      await db.insert(connectorState).values(input).onConflictDoUpdate({
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
  };
}
