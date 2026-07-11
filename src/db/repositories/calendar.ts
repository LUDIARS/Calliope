import { eq } from 'drizzle-orm';
import type { CalliopeDb } from '../client.ts';
import { calendarLink, planEntry } from '../schema.ts';

export interface CalendarLinkInput {
  id: string;
  calendarRef: string;
  syncDirection: 'read' | 'write' | 'both';
  enabled: boolean;
  updatedAt: string;
}

export function makeCalendarRepository(db: CalliopeDb) {
  return {
    async listCalendarLinks() {
      return db.select().from(calendarLink);
    },
    async upsertCalendarLink(input: CalendarLinkInput) {
      await db.insert(calendarLink).values(input).onConflictDoUpdate({
        target: calendarLink.id,
        set: {
          calendarRef: input.calendarRef,
          syncDirection: input.syncDirection,
          enabled: input.enabled,
          updatedAt: input.updatedAt,
        },
      });
      const rows = await db.select().from(calendarLink).where(eq(calendarLink.id, input.id)).limit(1);
      return rows[0] ?? null;
    },
    async setPlanEntrySchedulaEvent(entryId: string, eventId: string | null) {
      await db.update(planEntry).set({ schedulaEventId: eventId }).where(eq(planEntry.id, entryId));
    },
  };
}
