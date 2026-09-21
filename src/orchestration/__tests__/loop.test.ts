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

  it('runs task generation before the briefing and keeps going when it fails (§G2)', async () => {
    const order: string[] = [];
    const run = makeDailyLoop({
      reschedule: vi.fn(async () => { order.push('reschedule'); }),
      generate: vi.fn(async () => { order.push('generate'); return { confirmation: { id: 'c1' } }; }),
      briefing: vi.fn(async () => { order.push('briefing'); return { notification: { status: 'sent' } }; }),
    });
    await expect(run()).resolves.toMatchObject({
      warnings: [], generation: { confirmation: { id: 'c1' } },
    });
    expect(order).toEqual(['reschedule', 'generate', 'briefing']);

    const briefing = vi.fn(async () => ({ notification: { status: 'sent' } }));
    const failing = makeDailyLoop({
      reschedule: vi.fn(async () => undefined),
      generate: vi.fn(async () => { throw new TypeError('boom'); }),
      briefing,
    });
    await expect(failing()).resolves.toMatchObject({ warnings: ['generate_failed:TypeError'], generation: null });
    expect(briefing).toHaveBeenCalledOnce();
  });
});
