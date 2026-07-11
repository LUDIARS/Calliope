import { describe, expect, it, vi } from 'vitest';
import { makeDailyLoop } from '../loop.ts';

describe('daily loop', () => {
  it('still sends the briefing when rescheduling fails', async () => {
    const briefing = vi.fn(async () => ({ notification: { status: 'sent' } }));
    const run = makeDailyLoop({
      reschedule: vi.fn(async () => { throw new Error('temporary'); }),
      briefing,
    });
    await expect(run()).resolves.toMatchObject({
      warnings: ['reschedule_failed:Error'],
      briefing: { notification: { status: 'sent' } },
    });
    expect(briefing).toHaveBeenCalledOnce();
  });
});
