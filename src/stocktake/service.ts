import { randomUUID } from 'node:crypto';
import type { ActioClient } from '../clients/actio.ts';
import type { ActioTaskPriority } from '../clients/contracts.ts';
import type { MemoriaClient } from '../clients/memoria.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { makeTaskRef } from '../refs.ts';
import {
  composeStocktakeReport,
  DEFAULT_AGING_DAYS,
  DEFAULT_PRIORITY_GAP,
  type StocktakeReport,
  type StocktakeSignals,
  type StocktakeTask,
  type StocktakeThresholds,
} from './engine.ts';

const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;
/** 監査対象は未終了ステータス (done / cancelled を除く)。 */
const ACTIVE_STATUSES = new Set(['open', 'in_progress', 'blocked']);
/** Memoria agent_runs をどれだけ遡って done 突合するか。 */
const AGENT_RUN_LOOKBACK = 500;

export interface StocktakeServiceDeps {
  config: CalliopeConfig;
  actio: ActioClient;
  memoria: MemoriaClient;
  repo: CalliopeRepository;
  now?: () => Date;
}

export interface RunStocktakeResult {
  report: StocktakeReport;
  confirmation: { id: string; kind: 'task_stocktake'; expiresAt: string } | null;
}

function normalizeActioPriority(priority: string): ActioTaskPriority {
  return priority === 'med' ? 'medium' : (priority as ActioTaskPriority);
}

export function makeStocktakeService(deps: StocktakeServiceDeps) {
  const thresholds: StocktakeThresholds = {
    agingDays: deps.config.stocktake?.agingDays ?? DEFAULT_AGING_DAYS,
    priorityGap: deps.config.stocktake?.priorityGap ?? DEFAULT_PRIORITY_GAP,
  };

  async function gatherSignals(now: Date): Promise<StocktakeSignals> {
    const tasks = (await deps.actio.listTasks())
      .filter((task) => ACTIVE_STATUSES.has(task.status))
      .map<StocktakeTask>((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: normalizeActioPriority(task.priority),
        projectRef: task.projectId ?? task.category ?? null,
        // Actio は updatedAt を公開しないため createdAt を停滞アンカーに写す。
        updatedAt: task.createdAt,
      }));

    const doneTaskRefs = new Set<string>();
    for (const run of await deps.memoria.listAgentRuns({ limit: AGENT_RUN_LOOKBACK })) {
      if (run.status === 'done' && run.task_id) {
        doneTaskRefs.add(makeTaskRef('actio', run.task_id));
        doneTaskRefs.add(run.task_id);
      }
    }

    const resolvedPriorityByRef = new Map<string, number>();
    for (const row of await deps.repo.listPriorities({ scope: 'task' })) {
      resolvedPriorityByRef.set(row.ref, row.resolvedScore);
    }

    return { now, tasks, doneTaskRefs, resolvedPriorityByRef };
  }

  async function getReport(): Promise<StocktakeReport> {
    const now = deps.now?.() ?? new Date();
    return composeStocktakeReport(await gatherSignals(now), thresholds);
  }

  async function runStocktake(): Promise<RunStocktakeResult> {
    const now = deps.now?.() ?? new Date();
    const report = composeStocktakeReport(await gatherSignals(now), thresholds);
    if (report.proposals.length === 0) return { report, confirmation: null };
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS).toISOString();
    await deps.repo.createConfirmation({
      id,
      kind: 'task_stocktake',
      payload: {
        generatedAt: report.generatedAt,
        summary: report.summary,
        proposals: report.proposals,
      },
      createdAt: now.toISOString(),
      expiresAt,
    });
    return { report, confirmation: { id, kind: 'task_stocktake', expiresAt } };
  }

  return { getReport, runStocktake };
}

export type StocktakeService = ReturnType<typeof makeStocktakeService>;
