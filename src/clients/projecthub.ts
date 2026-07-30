// PROJECTHUB Hub の projects レジストリ (学生ゲーム制作 PJ 名簿) を read するコネクタ。
//
// Calliope docs/design/projecthub-pm.md §H3 の実装。 PROJECTHUB を学生ゲーム制作プロジェクトの
// 名簿・メンバー・リポ参照の正本として bind する (二重実装しない)。
//
// 実際の到達パス (spec/interface/projects-registry.md の「実際の到達パス」節参照):
//   設計文書は `GET /api/projecthub/projects` と表記するが、 Corpus の requireAuth が
//   `/api/*` 全体に既にかかっており (submodule 改変禁止のため変更不可)、
//   プラグインは `/api/x/<moduleId>` 配下にしかルートを持てない。 そのため実際の
//   read 専用ミラーは `GET /api/x/projects/external/projects` (一覧) /
//   `GET /api/x/projects/external/projects/:id` (詳細) になる。
//
// 認可は二層: (1) Corpus requireAuth (Cernere で検証可能な user bearer。 `token`
// が設定されていれば Authorization ヘッダで送る) + (2) PROJECTHUB 固有の
// requireServiceToken ゲート (`X-ProjectHub-Service-Token` ヘッダ、 env
// PROJECTHUB_PROJECTS_SERVICE_TOKEN と一致必須)。 未設定時の 503 は呼び出し元
// (clients/index.ts) が baseUrl / serviceToken 双方揃って初めてクライアントを
// 生成することで表現する (§7.1 無言フォールバック禁止 — 他コネクタと同じ規約)。

import { makeHttp } from './http.ts';
import {
  projecthubProjectResponseSchema,
  projecthubProjectsResponseSchema,
  type ProjectHubProject,
  type ProjectHubProjectMember,
} from './contracts.ts';

export interface ProjectHubClientOptions {
  baseUrl: string;
  /** Cernere で検証可能な user bearer token (他コネクタと同じ経路)。 未保持なら null。 */
  token: string | null;
  /** PROJECTHUB requireServiceToken ゲートに提示する固定トークン (X-ProjectHub-Service-Token)。必須。 */
  serviceToken: string;
}

const EXTERNAL_BASE = '/api/x/projects/external';

export function makeProjectHubClient(opts: ProjectHubClientOptions) {
  const http = makeHttp({
    baseUrl: opts.baseUrl,
    token: opts.token,
    service: 'projecthub',
    headers: { 'x-projecthub-service-token': opts.serviceToken },
  });

  return {
    health: () => http.get<unknown>('/api/health'),

    listProjects: async (): Promise<ProjectHubProject[]> => projecthubProjectsResponseSchema.parse(
      await http.get<unknown>(`${EXTERNAL_BASE}/projects`),
    ).projects,

    getProject: async (projectId: string): Promise<ProjectHubProject> => projecthubProjectResponseSchema.parse(
      await http.get<unknown>(`${EXTERNAL_BASE}/projects/${encodeURIComponent(projectId)}`),
    ).project,

    listMembers: async (projectId: string): Promise<ProjectHubProjectMember[]> => {
      const project = projecthubProjectResponseSchema.parse(
        await http.get<unknown>(`${EXTERNAL_BASE}/projects/${encodeURIComponent(projectId)}`),
      ).project;
      return project.members;
    },
  };
}

export type ProjectHubClient = ReturnType<typeof makeProjectHubClient>;
