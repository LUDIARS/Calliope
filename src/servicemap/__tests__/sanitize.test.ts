import { describe, expect, it } from 'vitest';
import { redactEndpoints } from '../sanitize.ts';

describe('redactEndpoints', () => {
  it('Villa 由来のラベル付きポート表記を伏せる', () => {
    expect(redactEndpoints('Actio 本体 (port: 3000)')).toBe('Actio 本体 (port: ***)');
    expect(redactEndpoints('ポート 17332 で待受')).toBe('ポート *** で待受');
    expect(redactEndpoints('PORT:8891')).toBe('PORT:***');
  });

  it('語中の port (export など) は伏せ字にしない', () => {
    expect(redactEndpoints('export 2026 件')).toBe('export 2026 件');
  });

  it('内部 URL のポートを伏せる', () => {
    expect(redactEndpoints('http://127.0.0.1:17332/api/v1/services'))
      .toBe('http://127.0.0.1:***/api/v1/services');
  });

  it('ポート以外の数字や時刻表記は壊さない', () => {
    expect(redactEndpoints('毎日 12:30 に集計する MUSA 9 女神の一つ'))
      .toBe('毎日 12:30 に集計する MUSA 9 女神の一つ');
    expect(redactEndpoints('')).toBe('');
  });
});
