import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeExcubitorClient } from '../excubitor.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockJson(payload: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

const client = () => makeExcubitorClient({ baseUrl: 'http://excubitor.test', token: null });

describe('makeExcubitorClient.listServices', () => {
  it('行と catalog_snapshot を合成し、disabled は除く', async () => {
    mockJson({
      services: [
        { code: 'actio', state: 'running', catalog_snapshot: { name: 'Actio', project_code: 'actio', tier: 'saas', port: '3000', description: '正本' } },
        { code: 'retired', catalog_snapshot: { disabled: true } },
        { catalog_snapshot: { name: 'code なし' } },
      ],
    });

    expect(await client().listServices()).toEqual([{
      code: 'actio',
      name: 'Actio',
      projectCode: 'actio',
      tier: 'saas',
      port: 3000,
      description: '正本',
      runState: 'running',
    }]);
  });

  it('範囲外のポートは null に落とす (行を捨てない)', async () => {
    mockJson({ services: [{ code: 'a', port: 70_000, state: 'stopped' }] });
    expect((await client().listServices())[0]).toMatchObject({ port: null, runState: 'stopped' });
  });

  // 形の変わった応答を「0 件の catalog」として受けると、全行が inCatalog=false へ
  // 倒れたまま同期成功と報告されてしまう。無言フォールバックさせない。
  it('services を欠く応答は既定値で補わず throw する', async () => {
    mockJson({ items: [] });
    await expect(client().listServices()).rejects.toThrow();
  });
});
