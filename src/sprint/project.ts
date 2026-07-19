// projectRef からスプリントの対象プロジェクト (Actio PM project か <private-reference-004> project か) を
// 解決する。 docs/design/<private-reference-004>-pm.md H4: sprint 設計/replan/close を `<private-reference-004>:<project_id>`
// scope にも適用するための分岐点。

import type { ActioClient } from '../clients/actio.ts';
import type { <private-reference-004>Client } from '../clients/<private-reference-004>.ts';
import type { CalliopeClients } from '../clients/index.ts';
import { parse<private-reference-004>ProjectRef } from '../refs.ts';
import { SprintPrerequisiteError } from './errors.ts';

export interface ActioPmProjectHandle {
  scope: 'actio-pm';
  actio: ActioClient;
  id: string;
  name: string;
}

export interface <private-reference-004>ProjectHandle {
  scope: '<private-reference-004>';
  actio: ActioClient;
  <private-reference-004>: <private-reference-004>Client;
  /** <private-reference-004> <private-reference-004>_project.id (不透明参照、prefix なし)。 Actio コア tasks.project_id の照合や
   *  <private-reference-004>Connector 呼び出しに使う。 */
  rawId: string;
  /** Calliope 内部の scope 文字列 (`<private-reference-004>:<rawId>`)。 sprint.projectRef / velocity.projectRef /
   *  priority.ref 等、既存の projectRef ベースの集計にそのまま載る。 */
  projectRef: string;
  name: string;
}

export type SprintProjectHandle = ActioPmProjectHandle | <private-reference-004>ProjectHandle;

export async function resolveSprintProject(
  clients: CalliopeClients,
  projectRef: string,
): Promise<SprintProjectHandle> {
  const <private-reference-004>Ref = parse<private-reference-004>ProjectRef(projectRef);
  if (<private-reference-004>Ref) {
    if (!clients.actio) throw new SprintPrerequisiteError(['actio']);
    if (!clients.<private-reference-004>) throw new SprintPrerequisiteError(['<private-reference-004>']);
    const project = await clients.<private-reference-004>.getProject(<private-reference-004>Ref.projectId);
    return {
      scope: '<private-reference-004>',
      actio: clients.actio,
      <private-reference-004>: clients.<private-reference-004>,
      rawId: <private-reference-004>Ref.projectId,
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
