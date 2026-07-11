export function makeDailyLoop(deps: {
  reschedule: () => Promise<unknown>;
  briefing: () => Promise<unknown>;
}) {
  return async () => {
    const warnings: string[] = [];
    try {
      await deps.reschedule();
    } catch (error) {
      warnings.push(`reschedule_failed:${error instanceof Error ? error.name : 'unknown'}`);
    }
    const briefing = await deps.briefing();
    return { briefing, warnings };
  };
}
