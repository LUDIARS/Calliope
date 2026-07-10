import type { ActioClient } from '../clients/actio.ts';
import type { AgentRun } from '../clients/contracts.ts';
import type { MemoriaClient } from '../clients/memoria.ts';
import type { CalliopeRepository, EstimateSource } from '../db/repository.ts';
import { makeTaskRef } from '../refs.ts';
import { projectRefForActioTask } from '../planning/tasks.ts';
import { calculateVelocity, type VelocitySample } from './calc.ts';

export interface VelocityEngineDeps {
  actio: ActioClient;
  memoria: MemoriaClient;
  repo: CalliopeRepository;
  now?: () => Date;
}

function actualMinutes(run: AgentRun): number | null {
  if (run.status !== 'done' || !run.finished_at) return null;
  const duration = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  return duration > 0 ? duration / 60_000 : null;
}

export function makeVelocityEngine(deps: VelocityEngineDeps) {
  return {
    async refresh() {
      const [tasks, runs, estimates] = await Promise.all([
        deps.actio.listTasks(),
        deps.memoria.listAgentRuns({ limit: 500 }),
        deps.repo.listTaskEstimates(),
      ]);
      const estimateByRef = new Map(estimates.map((estimate) => [estimate.taskRef, estimate]));
      const taskByIdentifier = new Map<string, (typeof tasks)[number]>();
      for (const task of tasks) {
        taskByIdentifier.set(task.id, task);
        if (task.pluginRef) taskByIdentifier.set(task.pluginRef, task);
      }

      const samples: VelocitySample[] = [];
      for (const run of runs) {
        if (!run.task_id) continue;
        const task = taskByIdentifier.get(run.task_id);
        const duration = actualMinutes(run);
        if (!task || duration === null || task.creatorType !== 'ai' || !task.completedAt) continue;
        const taskRef = makeTaskRef('actio', task.id);
        const storedEstimate = estimateByRef.get(taskRef);
        const estimateMinutes = task.estimatedMinutes ?? storedEstimate?.effortMinutes ?? null;
        if (!estimateMinutes || estimateMinutes <= 0) continue;
        const estimateSource: EstimateSource = task.estimatedMinutes !== null
          ? 'human'
          : storedEstimate?.estimateSource ?? 'human';
        await deps.repo.upsertTaskEstimate({
          taskRef,
          effortMinutes: Math.round(estimateMinutes),
          estimateSource,
          confidence: storedEstimate?.confidence ?? 1,
          estimatedAt: storedEstimate?.estimatedAt ?? task.completedAt,
        });
        samples.push({
          taskRef,
          category: task.category?.trim() || 'uncategorized',
          projectRef: projectRefForActioTask(task),
          estimateMinutes,
          actualMinutes: duration,
          completedAt: task.completedAt,
          estimateSource,
        });
      }

      const rows = calculateVelocity(samples, { windowEnd: deps.now?.() ?? new Date() });
      await deps.repo.replaceVelocityRows(rows);
      return {
        rows: rows.length,
        samples: samples.length,
        windowStart: rows[0]?.windowStart ?? null,
        windowEnd: rows[0]?.windowEnd ?? null,
      };
    },
  };
}
