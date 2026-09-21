/**
 * 候補検出のための signal 収集と、 裁定待ち confirmation の生成。
 * 上流呼び出しはここに閉じ、 engine.ts の純関数へ fixture として渡す。
 *
 * @spec Decision Inbox (task_create confirmation)
 * @spec 保持しないもの
 */

import { randomUUID } from 'node:crypto';
import type { ActioClient } from '../clients/actio.ts';
import type { CalliopeConfig } from '../config.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { loadPlanningTasks } from '../planning/tasks.ts';
import {
  composeTaskGenerationReport,
  type ExistingTask,
  type GoalRiskView,
  type PlanEntryView,
  type RetrospectiveActionView,
  type TaskGenerationReport,
  type TaskGenerationSignals,
} from './engine.ts';
import { taskCreateConfirmationPayloadSchema } from './payload.ts';

const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;
/** 再提案抑止の対象ステータス (design §G2: pending / rejected のうちは同一候補を出さない)。 */
const RESERVING_STATUSES = ['pending', 'rejected'] as const;

/** 週次振り返りの指摘だけを受け取る最小境界 (retrospective engine を丸ごと知らない)。 */
export interface RetrospectiveActionSource {
  getWeekly: () => Promise<{ recommendations: RetrospectiveActionView[] }>;
}

export interface TaskGenerationServiceDeps {
  config: CalliopeConfig;
  actio: ActioClient;
  repo: CalliopeRepository;
  retrospective: RetrospectiveActionSource;
  now?: () => Date;
}

export interface RunTaskGenerationResult {
  report: TaskGenerationReport;
  confirmation: { id: string; kind: 'task_create'; expiresAt: string } | null;
  /** 読めなかった既存 confirmation payload 等。 黙って捨てず呼び出し元へ返す。 */
  warnings: string[];
}

export function makeTaskGenerationService(deps: TaskGenerationServiceDeps) {
  async function gatherReservedKeys(): Promise<{ keys: Set<string>; warnings: string[] }> {
    const keys = new Set<string>();
    const warnings: string[] = [];
    for (const status of RESERVING_STATUSES) {
      for (const row of await deps.repo.listConfirmations(status)) {
        if (row.kind !== 'task_create') continue;
        const parsed = taskCreateConfirmationPayloadSchema.safeParse(row.payload);
        if (!parsed.success) {
          warnings.push(`invalid_task_create_payload:${row.id}`);
          continue;
        }
        for (const candidate of parsed.data.candidates) keys.add(candidate.key);
      }
    }
    return { keys, warnings };
  }

  async function gatherSignals(now: Date): Promise<{ signals: TaskGenerationSignals; warnings: string[] }> {
    const planningTasks = await loadPlanningTasks(deps.actio);
    const existingTasks: ExistingTask[] = planningTasks.map((task) => ({
      taskRef: task.taskRef,
      title: task.title,
    }));

    const closedSprints = await deps.repo.listSprints({ status: 'closed' });
    const sprints = await Promise.all(closedSprints.map(async (sprint) => {
      const withTasks = await deps.repo.getSprintWithTasks(sprint.id);
      return {
        id: sprint.id,
        projectRef: sprint.projectRef,
        goalRef: sprint.goalRef,
        periodEnd: sprint.periodEnd,
        status: sprint.status,
        tasks: (withTasks?.tasks ?? []).map((task) => ({ taskRef: task.taskRef, status: task.status })),
      };
    }));

    const risks: GoalRiskView[] = (await deps.repo.listGoalRisks()).map((risk) => ({
      goalRef: risk.goalRef,
      date: risk.date,
      level: risk.level,
      deadline: risk.deadline,
      projectedCompletion: risk.projectedCompletion,
    }));

    const activePlan = (await deps.repo.listPlans('active'))[0] ?? null;
    const planWithEntries = activePlan ? await deps.repo.getPlanWithEntries(activePlan.id) : null;
    const planEntries: PlanEntryView[] = (planWithEntries?.entries ?? []).map((entry) => ({
      planId: planWithEntries?.id ?? '',
      taskRef: entry.taskRef,
      lane: entry.lane,
    }));

    const retrospectiveActions = (await deps.retrospective.getWeekly()).recommendations;
    const reserved = await gatherReservedKeys();

    return {
      signals: {
        now,
        sprints,
        risks,
        planEntries,
        retrospectiveActions,
        existingTasks,
        reservedCandidateKeys: reserved.keys,
      },
      warnings: reserved.warnings,
    };
  }

  async function generate(): Promise<RunTaskGenerationResult> {
    const now = deps.now?.() ?? new Date();
    const { signals, warnings } = await gatherSignals(now);
    const report = composeTaskGenerationReport(signals);
    if (report.candidates.length === 0) return { report, confirmation: null, warnings };
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS).toISOString();
    await deps.repo.createConfirmation({
      id,
      kind: 'task_create',
      payload: {
        generatedAt: report.generatedAt,
        summary: report.summary,
        candidates: report.candidates,
      },
      createdAt: now.toISOString(),
      expiresAt,
    });
    return { report, confirmation: { id, kind: 'task_create', expiresAt }, warnings };
  }

  return { generate };
}

export type TaskGenerationService = ReturnType<typeof makeTaskGenerationService>;
