import { describe, expect, it, vi } from 'vitest';
import { estimateByAnalogy } from '../analogy.ts';
import { estimateWithLlm } from '../llm.ts';

describe('estimation', () => {
  it('requires at least three analogy samples', () => {
    expect(estimateByAnalogy(
      { category: 'code', labels: [] },
      [
        { category: 'code', labels: [], actualMinutes: 60 },
        { category: 'code', labels: [], actualMinutes: 120 },
      ],
    )).toBeNull();
  });

  it('uses the median and n/(n+5) confidence', () => {
    expect(estimateByAnalogy(
      { category: 'code', labels: ['api'] },
      [
        { category: 'code', labels: ['api'], actualMinutes: 60 },
        { category: 'code', labels: ['api'], actualMinutes: 180 },
        { category: 'code', labels: ['api'], actualMinutes: 120 },
      ],
    )).toEqual({ effortMinutes: 120, confidence: 3 / 8, sampleSize: 3 });
  });

  it('maps an injected LLM size response to minutes', async () => {
    const runner = vi.fn(async () => 'M\n');
    await expect(estimateWithLlm(
      { title: 'Implement API', details: null },
      { claudeBin: 'claude', cwd: 'C:\\repo', runner },
    )).resolves.toEqual({ effortMinutes: 240, size: 'M' });
    expect(runner).toHaveBeenCalledWith('claude', expect.arrayContaining(['-p']), {
      cwd: 'C:\\repo',
      timeoutMs: 60_000,
    });
  });

  it('rejects non-contract LLM output', async () => {
    const error = await estimateWithLlm(
      { title: 'Implement API', details: null },
      { claudeBin: 'claude', cwd: 'C:\\repo', runner: async () => 'private task details' },
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('invalid size');
    expect((error as Error).message).not.toContain('private task details');
  });
});
