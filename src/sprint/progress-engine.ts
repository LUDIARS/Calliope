// PROJECTHUB scope (`projecthub:<project_id>`) の PJ 別進捗レポート I/O オーケストレーション。
// docs/design/projecthub-pm.md H4: GET /api/projecthub/progress。 純粋な合成ロジックは progress.ts
// (composeProjectHubProjectProgress) に切り出し、 ここでは上流 (PROJECTHUB projects レジストリ /
// Actio コア tasks / Calliope repo の sprint・velocity) の読み出しだけを行う。
// 読み取り専用 — repo への書込は一切行わない (保存しない、が H4 完了条件)。

import type { CalliopeClients } from '../clients/index.ts';
import type { CalliopeRepository } from '../db/repository.ts';
import { makeProjectHubProjectRef, parseTaskRef } from '../refs.ts';
import { toProjectHubSprintTasks } from './projecthub-tasks.ts';
import { calculateProjectHubVelocityFallback } from './projecthub-velocity.ts';
import { composeProjectHubProjectProgress, type ProjectHubProjectProgress, type ProgressSprint } from './progress.ts';

export class ProjectHubProgressPrerequisiteError extends Error {
  constructor(public missing: string[]) {
    super(`projecthub progress prerequisites missing: ${missing.join(', ')}`);
    this.name = 'ProjectHubProgressPrerequisiteError';
  }
}

export interface ProjectHubProgressEngineDeps {
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

export function makeProjectHubProgressEngine(deps: ProjectHubProgressEngineDeps) {
  async function getProgress(
    filter: { projectId?: string } = {},
  ): Promise<{ generatedAt: string; projects: ProjectHubProjectProgress[] }> {
    const { clients, repo } = deps;
    if (!clients.projecthub) throw new ProjectHubProgressPrerequisiteError(['projecthub']);
    if (!clients.actio) throw new ProjectHubProgressPrerequisiteError(['actio']);
    const now = deps.now?.() ?? new Date();
    const [projecthubProjects, allTasks] = await Promise.all([
      clients.projecthub.listProjects(),
      clients.actio.listTasks(),
    ]);
    const targetProjects = filter.projectId
      ? projecthubProjects.filter((project) => project.id === filter.projectId)
      : projecthubProjects;
    const goalEvals = clients.memoria
      ? await clients.memoria.getGoalEvals(now.toISOString().slice(0, 7))
      : null;

    const projects = await Promise.all(targetProjects.map(async (project) => {
      const projectRef = makeProjectHubProjectRef(project.id);
      const sprints = await repo.listSprints({ projectRef });
      const summary = pickSprint(sprints);
      const sprintDetail = summary ? await repo.getSprintWithTasks(summary.id) : null;
      const currentTasks = toProjectHubSprintTasks(allTasks, project.id);
      const velocities = await repo.listLatestVelocity({ projectRef });
      const storedVelocity = velocities.find((row) => row.category === '*') ?? null;
      const velocity = storedVelocity ?? calculateProjectHubVelocityFallback(projectRef, currentTasks, now);

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

      return composeProjectHubProjectProgress({
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
