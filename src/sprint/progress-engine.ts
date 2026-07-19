// <private-reference-004> scope (`<private-reference-004>:<project_id>`) の PJ 別進捗レポート I/O オーケストレーション。
// docs/design/<private-reference-004>-pm.md H4: GET /api/<private-reference-004>/progress。 純粋な合成ロジックは progress.ts
// (compose<private-reference-004>ProjectProgress) に切り出し、 ここでは上流 (<private-reference-004> projects レジストリ /
// Actio コア tasks / Calliope repo の sprint・velocity) の読み出しだけを行う。
// 読み取り専用 — repo への書込は一切行わない (保存しない、が H4 完了条件)。

import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { make<private-reference-004>ProjectRef, parseTaskRef } from '../refs.ts';
import { to<private-reference-004>SprintTasks } from './<private-reference-004>-tasks.ts';
import { calculate<private-reference-004>VelocityFallback } from './<private-reference-004>-velocity.ts';
import { compose<private-reference-004>ProjectProgress, type <private-reference-004>ProjectProgress, type ProgressSprint } from './progress.ts';

export class <private-reference-004>ProgressPrerequisiteError extends Error {
  constructor(public missing: string[]) {
    super(`<private-reference-004> progress prerequisites missing: ${missing.join(', ')}`);
    this.name = '<private-reference-004>ProgressPrerequisiteError';
  }
}

export interface <private-reference-004>ProgressEngineDeps {
  clients: CalliopeClients;
  repo: CalliopeRepository;
  now?: () => Date;
}

type SprintSummary = Awaited<ReturnType<CalliopeRepository['listSprints']>>[number];

function pickSprint(sprints: SprintSummary[]): SprintSummary | null {
  const active = sprints.find((row) => row.status === 'active');
  if (active) return active;
  const planned = [...sprints]
    .filter((row) => row.status === 'planned')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (planned) return planned;
  const closed = [...sprints]
    .filter((row) => row.status === 'closed')
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0];
  return closed ?? null;
}

export function make<private-reference-004>ProgressEngine(deps: <private-reference-004>ProgressEngineDeps) {
  async function getProgress(
    filter: { projectId?: string } = {},
  ): Promise<{ generatedAt: string; projects: <private-reference-004>ProjectProgress[] }> {
    const { clients, repo } = deps;
    if (!clients.<private-reference-004>) throw new <private-reference-004>ProgressPrerequisiteError(['<private-reference-004>']);
    if (!clients.actio) throw new <private-reference-004>ProgressPrerequisiteError(['actio']);
    const now = deps.now?.() ?? new Date();
    const [<private-reference-004>Projects, allTasks] = await Promise.all([
      clients.<private-reference-004>.listProjects(),
      clients.actio.listTasks(),
    ]);
    const targetProjects = filter.projectId
      ? <private-reference-004>Projects.filter((project) => project.id === filter.projectId)
      : <private-reference-004>Projects;
    const goalEvals = clients.memoria
      ? await clients.memoria.getGoalEvals(now.toISOString().slice(0, 7))
      : null;

    const projects = await Promise.all(targetProjects.map(async (project) => {
      const projectRef = make<private-reference-004>ProjectRef(project.id);
      const sprints = await repo.listSprints({ projectRef });
      const summary = pickSprint(sprints);
      const sprintDetail = summary ? await repo.getSprintWithTasks(summary.id) : null;
      const currentTasks = to<private-reference-004>SprintTasks(allTasks, project.id);
      const velocities = await repo.listLatestVelocity({ projectRef });
      const storedVelocity = velocities.find((row) => row.category === '*') ?? null;
      const velocity = storedVelocity ?? calculate<private-reference-004>VelocityFallback(projectRef, currentTasks, now);

      let goalDeadline: string | null = null;
      let latestGoalEval: { status: 'todo' | 'doing' | 'done' } | null = null;
      if (sprintDetail?.goalRef) {
        const parsed = parseTaskRef(sprintDetail.goalRef);
        const goalSourceId = parsed.source === 'actio' ? parsed.taskId : null;
        const goalTask = goalSourceId ? allTasks.find((task) => task.id === goalSourceId) : undefined;
        goalDeadline = goalTask?.deadline ?? null;
        latestGoalEval = goalEvals
          ?.filter((item) => item.goal_id === goalSourceId)
          .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
      }

      return compose<private-reference-004>ProjectProgress({
        now,
        project: { rawId: project.id, projectRef, name: project.name },
        sprint: sprintDetail as ProgressSprint | null,
        currentTasks,
        velocity,
        goalDeadline,
        latestGoalEval,
      });
    }));

    return { generatedAt: now.toISOString(), projects };
  }

  return { getProgress };
}
