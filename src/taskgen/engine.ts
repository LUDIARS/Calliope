import { isProjectHubProjectRef } from '../refs.ts';
import { normalizeTitle } from '../tasks/title.ts';

/**
 * docs/design/task-lifecycle.md §G2 の検出エンジン (純関数、 I/O なし)。
 * 「Actio にあるべきなのに無いタスク」 を計画成果物 4 系統から検出する。
 * 実際の起票は confirmation (`kind: task_create`) の approve 後にのみ行われる。
 *
 * @spec 候補検出 4 系統
 * @spec dedup と再提案抑止
 */

export type TaskCandidateSource =
  | 'sprint_carryover'
  | 'risk_red'
  | 'plan_gap'
  | 'retrospective_action';

export type SuppressionReason =
  | 'existing_task_ref'
  | 'existing_title'
  | 'duplicate_candidate'
  | 'open_confirmation';

/** Actio 側に既にあるタスクの最小ビュー (id 参照 + タイトルのみ)。 */
export interface ExistingTask {
  taskRef: string;
  title: string;
}

/** 閉じたスプリントの carryover 判定に必要な最小ビュー。 */
export interface CarryoverSprintView {
  id: string;
  projectRef: string;
  goalRef: string | null;
  periodEnd: string;
  status: string;
  tasks: Array<{ taskRef: string; status: string }>;
}

export interface GoalRiskView {
  goalRef: string;
  date: string;
  level: 'green' | 'amber' | 'red';
  deadline: string;
  projectedCompletion: string;
}

export interface PlanEntryView {
  planId: string;
  taskRef: string;
  lane: string;
}

/** 週次振り返り (F7) の指摘。 composeWeeklyRetrospective の recommendations と同形。 */
export interface RetrospectiveActionView {
  code: string;
  message: string;
}

export interface TaskCandidate {
  /** 候補の安定キー。 再提案抑止 (pending / rejected confirmation) の突合に使う。 */
  key: string;
  source: TaskCandidateSource;
  title: string;
  /** Actio 起票時の external_id。 key から決定的に導出し、 Actio 側の冪等性も担保する。 */
  externalId: string;
  originTaskRef: string | null;
  projectRef: string | null;
  goalRef: string | null;
  category: string | null;
  dueAt: string | null;
  /** 生成根拠 (短文)。 個人データは持たず id 参照と閾値事実のみ。 */
  reason: string;
}

export interface SuppressedCandidate {
  key: string;
  source: TaskCandidateSource;
  reason: SuppressionReason;
}

export interface ExistingTaskIndex {
  refs: Set<string>;
  titles: Set<string>;
}

/** ISO 8601 の 「時刻 + オフセット付き」 のみ due_at として通す (Actio 契約が offset 必須)。 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isoInstantOrNull(value: string | null): string | null {
  return value !== null && ISO_INSTANT.test(value) ? value : null;
}

function externalIdForKey(key: string): string {
  const slug = key.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `calliope-taskgen-${slug || 'unknown'}`;
}

function makeKey(source: TaskCandidateSource, discriminator: string): string {
  return `${source}|${discriminator}`;
}

/** projecthub:<id> は不透明参照のため Actio の category には載せない (H1 最終裁定)。 */
function categoryForProjectRef(projectRef: string | null): string | null {
  if (!projectRef || isProjectHubProjectRef(projectRef)) return null;
  return projectRef;
}

export function buildExistingTaskIndex(tasks: ExistingTask[]): ExistingTaskIndex {
  const refs = new Set<string>();
  const titles = new Set<string>();
  for (const task of tasks) {
    refs.add(task.taskRef);
    const normalized = normalizeTitle(task.title);
    if (normalized) titles.add(normalized);
  }
  return { refs, titles };
}

/**
 * G2-1 sprint carryover: 閉じたスプリントに committed のまま残った task_ref のうち、
 * Actio 側に該当タスクが無い (削除された / 起票されていない) ものを再起票候補にする。
 */
export function detectSprintCarryover(sprints: CarryoverSprintView[]): TaskCandidate[] {
  const candidates: TaskCandidate[] = [];
  for (const sprint of sprints) {
    if (sprint.status !== 'closed') continue;
    for (const task of sprint.tasks) {
      if (task.status !== 'committed') continue;
      const key = makeKey('sprint_carryover', task.taskRef);
      candidates.push({
        key,
        source: 'sprint_carryover',
        title: `Restore carryover task ${task.taskRef}`,
        externalId: externalIdForKey(key),
        originTaskRef: task.taskRef,
        projectRef: sprint.projectRef,
        goalRef: sprint.goalRef,
        category: categoryForProjectRef(sprint.projectRef),
        dueAt: null,
        reason: `carryover from closed sprint ${sprint.id} (period_end ${sprint.periodEnd}); ` +
          `task_ref ${task.taskRef} is missing in Actio`,
      });
    }
  }
  return candidates;
}

/** goal_ref ごとに最新日付のスナップショットだけを残す。 */
export function latestRiskByGoal(risks: GoalRiskView[]): GoalRiskView[] {
  const latest = new Map<string, GoalRiskView>();
  for (const risk of risks) {
    const current = latest.get(risk.goalRef);
    if (!current || current.date < risk.date) latest.set(risk.goalRef, risk);
  }
  return [...latest.values()];
}

/**
 * G2-2 risk red フォローアップ: 最新の goal_risk_snapshot が red の goal に対策検討タスクを提案する。
 * 「赤が続く間の再提案」 は dedup 層 (既存タスク / pending・rejected confirmation) が抑止する。
 */
export function detectRiskRedFollowUps(risks: GoalRiskView[]): TaskCandidate[] {
  return latestRiskByGoal(risks)
    .filter((risk) => risk.level === 'red')
    .map((risk) => {
      const key = makeKey('risk_red', risk.goalRef);
      return {
        key,
        source: 'risk_red' as const,
        title: `Risk mitigation for ${risk.goalRef}`,
        externalId: externalIdForKey(key),
        originTaskRef: null,
        projectRef: null,
        goalRef: risk.goalRef,
        category: null,
        dueAt: isoInstantOrNull(risk.deadline),
        reason: `goal risk is red on ${risk.date}: projected ${risk.projectedCompletion} ` +
          `vs deadline ${risk.deadline}`,
      };
    });
}

/**
 * G2-3 plan gap: active plan の entry が参照する task_ref が Actio に無い (孤児 entry) 場合の再起票候補。
 * 孤児判定は dedup 層 (existing_task_ref) が行うため、 ここでは entry を候補へ写すだけ。
 */
export function detectPlanGaps(entries: PlanEntryView[]): TaskCandidate[] {
  return entries.map((entry) => {
    const key = makeKey('plan_gap', entry.taskRef);
    return {
      key,
      source: 'plan_gap' as const,
      title: `Restore planned task ${entry.taskRef}`,
      externalId: externalIdForKey(key),
      originTaskRef: entry.taskRef,
      projectRef: null,
      goalRef: null,
      category: null,
      dueAt: null,
      reason: `active plan ${entry.planId} lane ${entry.lane} references ${entry.taskRef}, ` +
        'which is missing in Actio',
    };
  });
}

/** G2-4 retrospective action: 週次振り返りの指摘 (velocity drift / scope creep 等) を改善タスク候補にする。 */
export function detectRetrospectiveActions(actions: RetrospectiveActionView[]): TaskCandidate[] {
  return actions.map((action) => {
    const key = makeKey('retrospective_action', action.code);
    return {
      key,
      source: 'retrospective_action' as const,
      title: `Retrospective action: ${action.code}`,
      externalId: externalIdForKey(key),
      originTaskRef: null,
      projectRef: null,
      goalRef: null,
      category: null,
      dueAt: null,
      reason: action.message,
    };
  });
}

export interface DedupeResult {
  candidates: TaskCandidate[];
  suppressed: SuppressedCandidate[];
}

/**
 * dedup (design §G2 必須要件)。 除外理由は捨てず suppressed として報告する (無言 fallback 禁止)。
 * 1. task_ref が Actio に既存 → 起票不要 (孤児ではない)。
 * 2. 正規化タイトルが既存タスクと一致 → 重複起票を防ぐ。
 * 3. 同一 run 内でタイトルが衝突 → 先勝ち。
 * 4. 同一 key の候補が pending / rejected の confirmation に既にある → 再提案抑止。
 */
export function dedupeCandidates(
  candidates: TaskCandidate[],
  existing: ExistingTaskIndex,
  reservedKeys: Set<string>,
): DedupeResult {
  const accepted: TaskCandidate[] = [];
  const suppressed: SuppressedCandidate[] = [];
  const seenTitles = new Set<string>();
  const seenKeys = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeTitle(candidate.title);
    if (candidate.originTaskRef && existing.refs.has(candidate.originTaskRef)) {
      suppressed.push({ key: candidate.key, source: candidate.source, reason: 'existing_task_ref' });
      continue;
    }
    if (reservedKeys.has(candidate.key)) {
      suppressed.push({ key: candidate.key, source: candidate.source, reason: 'open_confirmation' });
      continue;
    }
    // 同一 run 内の key 衝突 (例: 複数の closed sprint が同じ task_ref を carryover) は
    // confirmation 由来ではないので duplicate_candidate として報告する。
    if (seenKeys.has(candidate.key)) {
      suppressed.push({ key: candidate.key, source: candidate.source, reason: 'duplicate_candidate' });
      continue;
    }
    if (existing.titles.has(normalized)) {
      suppressed.push({ key: candidate.key, source: candidate.source, reason: 'existing_title' });
      continue;
    }
    if (seenTitles.has(normalized)) {
      suppressed.push({ key: candidate.key, source: candidate.source, reason: 'duplicate_candidate' });
      continue;
    }
    seenTitles.add(normalized);
    seenKeys.add(candidate.key);
    accepted.push(candidate);
  }
  return { candidates: accepted, suppressed };
}

export interface TaskGenerationSignals {
  now: Date;
  sprints: CarryoverSprintView[];
  risks: GoalRiskView[];
  planEntries: PlanEntryView[];
  retrospectiveActions: RetrospectiveActionView[];
  existingTasks: ExistingTask[];
  /** pending / rejected な task_create confirmation が既に抱えている候補 key。 */
  reservedCandidateKeys: Set<string>;
}

/** 4 系統の検出を合成し、 dedup 後の候補リストと抑止内訳を返す純関数。 */
export function composeTaskGenerationReport(signals: TaskGenerationSignals) {
  const detected = [
    ...detectSprintCarryover(signals.sprints),
    ...detectRiskRedFollowUps(signals.risks),
    ...detectPlanGaps(signals.planEntries),
    ...detectRetrospectiveActions(signals.retrospectiveActions),
  ];
  const { candidates, suppressed } = dedupeCandidates(
    detected,
    buildExistingTaskIndex(signals.existingTasks),
    signals.reservedCandidateKeys,
  );
  const countBySource = (source: TaskCandidateSource) =>
    candidates.filter((candidate) => candidate.source === source).length;
  return {
    generatedAt: signals.now.toISOString(),
    candidates,
    suppressed,
    summary: {
      sprintCarryover: countBySource('sprint_carryover'),
      riskRed: countBySource('risk_red'),
      planGap: countBySource('plan_gap'),
      retrospectiveAction: countBySource('retrospective_action'),
      candidates: candidates.length,
      suppressed: suppressed.length,
    },
  };
}

export type TaskGenerationReport = ReturnType<typeof composeTaskGenerationReport>;
