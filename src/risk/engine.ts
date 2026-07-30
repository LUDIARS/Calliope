import { randomUUID } from 'node:crypto';
import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { loadPlanningTasks } from '../planning/tasks.ts';
import { isProjectHubProjectRef } from '../refs.ts';
import { estimateP80Factor, velocityConfidence } from '../velocity/distribution.ts';
import { evaluateGoalRisk } from './score.ts';

export class RiskPrerequisiteError extends Error {
  constructor(public missing: string[]) {
    super(`risk prerequisites missing: ${missing.join(', ')}`);
    this.name = 'RiskPrerequisiteError';
  }
}

export interface RiskEngineDeps {
  clients: CalliopeClients;
  repo: CalliopeRepository;
  now?: () => Date;
  id?: () => string;
}

function findVelocity(
  rows: Array<{ projectRef: string; category: string; kFactor: number; distribution: unknown; sampleSize: number }>,
  projectRef: string,
) {
  return rows.find((row) => row.projectRef === projectRef && row.category === '*') ??
    rows.find((row) => row.projectRef === projectRef) ??
    rows.find((row) => row.projectRef === '*' && row.category === '*') ??
    null;
}

function scopeCreepFromSnapshot(snapshot: { gompertzParams: unknown } | undefined): number {
  const params = snapshot?.gompertzParams;
  if (!params || typeof params !== 'object' || !('health' in params)) return 0;
  const health = (params as { health?: unknown }).health;
  if (!health || typeof health !== 'object' || !('scopeCreepRate' in health)) return 0;
  const value = (health as { scopeCreepRate?: unknown }).scopeCreepRate;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function makeRiskEngine(deps: RiskEngineDeps) {
  return {
    async refresh(input: { sprintId?: string } = {}) {
      const actio = deps.clients.actio;
      if (!actio) throw new RiskPrerequisiteError(['actio']);
      const [sprints, velocities, planningTasks] = await Promise.all([
        input.sprintId
          ? deps.repo.getSprintWithTasks(input.sprintId).then((item) => item ? [item] : [])
          : deps.repo.listSprints(),
        deps.repo.listLatestVelocity(),
        loadPlanningTasks(actio),
      ]);
      if (input.sprintId && sprints.length === 0) throw new Error(`sprint not found: ${input.sprintId}`);
      const now = deps.now?.() ?? new Date();
      const snapshots = [];
      const skipped: Array<{ sprintId: string; reason: string }> = [];
      const orderedSprints = [...sprints].sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (b.status === 'active' && a.status !== 'active') return 1;
        return b.periodStart.localeCompare(a.periodStart);
      });
      const seenGoals = new Set<string>();
      for (const sprint of orderedSprints) {
        if (sprint.status === 'closed') {
          skipped.push({ sprintId: sprint.id, reason: 'sprint_closed' });
          continue;
        }
        if (isProjectHubProjectRef(sprint.projectRef)) {
          // docs/design/projecthub-pm.md H4: PROJECTHUB scope の学生 PJ タスクは Actio PM の critical-path
          // 分析 API を持たない (PM プロジェクトではなく Actio コア tasks.project_id 紐付けのため)。
          // ここでの goal-risk snapshot (Gompertz/critical-path 前提) は対象外とし、
          // PROJECTHUB scope の進捗/リスクは GET /api/projecthub/progress (src/sprint/progress.ts) が
          // 縮退モードで on-demand に合成する (無言フォールバックにせず明示スキップする)。
          skipped.push({ sprintId: sprint.id, reason: 'projecthub_scope_unsupported_for_goal_risk' });
          continue;
        }
        if (!sprint.goalRef) {
          skipped.push({ sprintId: sprint.id, reason: 'goal_ref_missing' });
          continue;
        }
        if (seenGoals.has(sprint.goalRef)) {
          skipped.push({ sprintId: sprint.id, reason: 'duplicate_goal_sprint' });
          continue;
        }
        seenGoals.add(sprint.goalRef);
        const velocity = findVelocity(velocities, sprint.projectRef);
        if (!velocity) throw new RiskPrerequisiteError([`velocity:${sprint.projectRef}`]);
        const [criticalPath, curves, previous] = await Promise.all([
          actio.getCriticalPath(sprint.projectRef),
          deps.repo.listCurveSnapshots(sprint.id),
          deps.repo.getLatestGoalRisk(sprint.goalRef),
        ]);
        const goal = planningTasks.find((task) => task.taskRef === sprint.goalRef);
        const deadline = goal?.dueAt ?? sprint.periodEnd;
        const deadlineSource = goal?.dueAt ? 'goal' : 'sprint';
        const p50Factor = Math.max(velocity.kFactor, 0);
        const p80Factor = Math.max(estimateP80Factor(velocity.distribution, p50Factor), p50Factor);
        const risk = evaluateGoalRisk({
          now,
          deadline,
          criticalPathDays: criticalPath.totalEstimatedDays,
          p50Factor,
          p80Factor,
        });
        const latestCurve = curves.at(-1);
        const openCriticalNodes = criticalPath.path.filter((node) =>
          !['done', 'closed', 'cancelled'].includes(node.status.toLowerCase())).length;
        const factors = {
          p50Completion: risk.projectedCompletion,
          p80Completion: risk.p80Completion,
          p50Factor,
          p80Factor,
          velocityConfidence: velocityConfidence(velocity.sampleSize, velocity.distribution),
          criticalPathDays: criticalPath.totalEstimatedDays,
          criticalPathOpenNodes: openCriticalNodes,
          dependencyStall: openCriticalNodes > 0 && criticalPath.riskLevel !== 'low',
          scopeCreepRate: scopeCreepFromSnapshot(latestCurve),
          deadlineSource,
          slackDaysP50: risk.slackDaysP50,
          slackDaysP80: risk.slackDaysP80,
        };
        const row = {
          id: (deps.id ?? randomUUID)(),
          goalRef: sprint.goalRef,
          date: now.toISOString().slice(0, 10),
          projectedCompletion: risk.projectedCompletion,
          deadline: risk.deadline,
          level: risk.level,
          factors,
          createdAt: now.toISOString(),
        };
        const becameRed = risk.level === 'red' && previous?.level !== 'red';
        const persisted = await deps.repo.upsertGoalRiskSnapshot(row);
        snapshots.push({
          ...persisted,
          sprintId: sprint.id,
          becameRed,
          notificationRequired: becameRed,
          notificationStatus: becameRed ? 'not_sent_missing_authenticated_recipient_context' : 'not_required',
        });
      }
      return { snapshots, skipped };
    },
  };
}
