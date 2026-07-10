import type { ActioClient } from '../clients/actio.ts';
import type { AgentRun } from '../clients/contracts.ts';
import type { MemoriaClient } from '../clients/memoria.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { loadPlanningTasks, type PlanningTask } from '../planning/tasks.ts';
import { estimateByAnalogy, type AnalogySample } from './analogy.ts';
import { estimateWithLlm, type LlmRunner } from './llm.ts';

export interface EstimationEngineDeps {
  actio: ActioClient;
  memoria: MemoriaClient | null;
  repo: CalliopeRepository;
  claudeBin: string;
  llmEnabled: boolean;
  cwd?: string;
  now?: () => Date;
  llmRunner?: LlmRunner;
}

function runDuration(run: AgentRun): number | null {
  if (run.status !== 'done' || !run.finished_at) return null;
  const duration = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  return duration > 0 ? duration / 60_000 : null;
}

function analogySamples(tasks: PlanningTask[], runs: AgentRun[]): AnalogySample[] {
  const byIdentifier = new Map<string, PlanningTask>();
  for (const task of tasks) {
    byIdentifier.set(task.sourceId, task);
    if (task.legacyTaskId) byIdentifier.set(task.legacyTaskId, task);
  }
  return runs.flatMap((run) => {
    if (!run.task_id) return [];
    const task = byIdentifier.get(run.task_id);
    const actualMinutes = runDuration(run);
    if (!task || actualMinutes === null) return [];
    return [{ category: task.category, labels: task.labels, actualMinutes }];
  });
}

export function makeEstimationEngine(deps: EstimationEngineDeps) {
  return {
    async refresh() {
      const tasks = await loadPlanningTasks(deps.actio);
      const [runs, stored] = await Promise.all([
        deps.memoria ? deps.memoria.listAgentRuns({ limit: 500 }) : Promise.resolve([]),
        deps.repo.listTaskEstimates(),
      ]);
      const storedByRef = new Map(stored.map((estimate) => [estimate.taskRef, estimate]));
      const samples = analogySamples(tasks, runs);
      const now = (deps.now?.() ?? new Date()).toISOString();
      let estimated = 0;
      let skippedLlm = 0;
      const unresolved: string[] = [];

      for (const task of tasks) {
        if (task.estimateMinutes !== null && task.estimateMinutes > 0) {
          await deps.repo.upsertTaskEstimate({
            taskRef: task.taskRef,
            effortMinutes: Math.round(task.estimateMinutes),
            estimateSource: 'human',
            confidence: 1,
            estimatedAt: now,
          });
          estimated += 1;
          continue;
        }
        if (storedByRef.has(task.taskRef)) continue;

        const analogy = estimateByAnalogy(task, samples);
        if (analogy) {
          await deps.repo.upsertTaskEstimate({
            taskRef: task.taskRef,
            effortMinutes: analogy.effortMinutes,
            estimateSource: 'analogy',
            confidence: analogy.confidence,
            estimatedAt: now,
          });
          estimated += 1;
          continue;
        }

        if (!deps.llmEnabled) {
          skippedLlm += 1;
          unresolved.push(task.taskRef);
          continue;
        }

        const llm = await estimateWithLlm(task, {
          claudeBin: deps.claudeBin,
          cwd: deps.cwd ?? process.cwd(),
          runner: deps.llmRunner,
        });
        await deps.repo.upsertTaskEstimate({
          taskRef: task.taskRef,
          effortMinutes: llm.effortMinutes,
          estimateSource: 'llm',
          confidence: 0.4,
          estimatedAt: now,
        });
        estimated += 1;
      }

      return {
        estimated,
        skipped_llm: skippedLlm,
        unresolved,
        warnings: deps.memoria ? [] : ['memoria_unconfigured: analogy samples unavailable'],
      };
    },
  };
}
