/**
 * 日次 07:30 JST の実行順序 (reschedule → generate → briefing)。
 * 途中の失敗は warnings に積み、 後続ステップは続行する。
 *
 * @spec 実行タイミング
 */

export interface DailyLoopDeps {
  reschedule: () => Promise<unknown>;
  /**
   * docs/design/task-lifecycle.md §G2: タスク自動生成 (候補検出 → task_create confirmation)。
   * briefing より前に回して当日の 「タスク生成候補 n 件」 を載せる。 未設定なら実行しない。
   */
  generate?: () => Promise<unknown>;
  briefing: () => Promise<unknown>;
}

export function makeDailyLoop(deps: DailyLoopDeps) {
  return async () => {
    const warnings: string[] = [];
    try {
      await deps.reschedule();
    } catch (error) {
      warnings.push(`reschedule_failed:${error instanceof Error ? error.name : 'unknown'}`);
    }
    let generation: unknown = null;
    if (deps.generate) {
      try {
        generation = await deps.generate();
      } catch (error) {
        warnings.push(`generate_failed:${error instanceof Error ? error.name : 'unknown'}`);
      }
    }
    const briefing = await deps.briefing();
    return { briefing, generation, warnings };
  };
}
