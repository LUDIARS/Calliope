// projectRef からスプリントの対象プロジェクト (Actio PM project か PROJECTHUB project か) を
// 解決する。 docs/design/projecthub-pm.md H4: sprint 設計/replan/close を `projecthub:<project_id>`
// scope にも適用するための分岐点。

import type { ActioClient } from '../clients/actio.ts';
import type { ProjectHubClient } from '../clients/projecthub.ts';
import type { CalliopeClients } from '../clients/index.ts';
import { parseProjectHubProjectRef } from '../refs.ts';
import { SprintPrerequisiteError } from './errors.ts';

export interface ActioPmProjectHandle {
  scope: 'actio-pm';
  actio: ActioClient;
  id: string;
  name: string;
}

export interface ProjectHubProjectHandle {
  scope: 'projecthub';
  actio: ActioClient;
  projecthub: ProjectHubClient;
  /** PROJECTHUB projecthub_project.id (不透明参照、prefix なし)。 Actio コア tasks.project_id の照合や
   *  ProjectHubConnector 呼び出しに使う。 */
  rawId: string;
  /** Calliope 内部の scope 文字列 (`projecthub:<rawId>`)。 sprint.projectRef / velocity.projectRef /
   *  priority.ref 等、既存の projectRef ベースの集計にそのまま載る。 */
  projectRef: string;
  name: string;
}

export type SprintProjectHandle = ActioPmProjectHandle | ProjectHubProjectHandle;

export async function resolveSprintProject(
  clients: CalliopeClients,
  projectRef: string,
): Promise<SprintProjectHandle> {
  const projecthubRef = parseProjectHubProjectRef(projectRef);
  if (projecthubRef) {
    if (!clients.actio) throw new SprintPrerequisiteError(['actio']);
    if (!clients.projecthub) throw new SprintPrerequisiteError(['projecthub']);
    const project = await clients.projecthub.getProject(projecthubRef.projectId);
    return {
      scope: 'projecthub',
      actio: clients.actio,
      projecthub: clients.projecthub,
      rawId: projecthubRef.projectId,
      projectRef,
      name: project.name,
    };
  }
  if (!clients.actio) throw new SprintPrerequisiteError(['actio']);
  const projects = await clients.actio.listPmProjects();
  const project = projects.find((item) => item.id === projectRef || item.name === projectRef);
  if (!project) throw new Error(`project not found: ${projectRef}`);
  return { scope: 'actio-pm', actio: clients.actio, id: project.id, name: project.name };
}
