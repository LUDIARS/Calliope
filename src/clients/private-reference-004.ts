// <private-reference-004> Hub の projects レジストリ (学生ゲーム制作 PJ 名簿) を read するコネクタ。
//
// Calliope docs/design/<private-reference-004>-pm.md §H3 の実装。 <private-reference-004> を学生ゲーム制作プロジェクトの
// 名簿・メンバー・リポ参照の正本として bind する (二重実装しない)。
//
// 実際の到達パス (spec/interface/projects-registry.md の「実際の到達パス」節参照):
//   設計文書は `GET /api/<private-reference-004>/projects` と表記するが、 Corpus の requireAuth が
//   `/api/*` 全体に既にかかっており (submodule 改変禁止のため変更不可)、
//   プラグインは `/api/x/<moduleId>` 配下にしかルートを持てない。 そのため実際の
//   read 専用ミラーは `GET /api/x/projects/external/projects` (一覧) /
//   `GET /api/x/projects/external/projects/:id` (詳細) になる。
//
// 認可は二層: (1) Corpus requireAuth (Cernere で検証可能な user bearer。 `token`
// が設定されていれば Authorization ヘッダで送る) + (2) <private-reference-004> 固有の
// requireServiceToken ゲート (`X-<private-reference-004>-Service-Token` ヘッダ、 env
// <private-reference-004>_PROJECTS_SERVICE_TOKEN と一致必須)。 未設定時の 503 は呼び出し元
// (clients/index.ts) が baseUrl / serviceToken 双方揃って初めてクライアントを
// 生成することで表現する (§7.1 無言フォールバック禁止 — 他コネクタと同じ規約)。

import { makeHttp } from './http.ts';
import {
  <private-reference-004>ProjectResponseSchema,
  <private-reference-004>ProjectsResponseSchema,
  type <private-reference-004>Project,
  type <private-reference-004>ProjectMember,
} from './contracts.ts';

export interface <private-reference-004>ClientOptions {
  baseUrl: string;
  /** Cernere で検証可能な user bearer token (他コネクタと同じ経路)。 未保持なら null。 */
  token: string | null;
  /** <private-reference-004> requireServiceToken ゲートに提示する固定トークン (X-<private-reference-004>-Service-Token)。必須。 */
  serviceToken: string;
}

const EXTERNAL_BASE = '/api/x/projects/external';

export function make<private-reference-004>Client(opts: <private-reference-004>ClientOptions) {
  const http = makeHttp({
    baseUrl: opts.baseUrl,
    token: opts.token,
    service: '<private-reference-004>',
    headers: { 'x-<private-reference-004>-service-token': opts.serviceToken },
  });

  return {
    health: () => http.get<unknown>('/api/health'),

    listProjects: async (): Promise<<private-reference-004>Project[]> => <private-reference-004>ProjectsResponseSchema.parse(
      await http.get<unknown>(`${EXTERNAL_BASE}/projects`),
    ).projects,

    getProject: async (projectId: string): Promise<<private-reference-004>Project> => <private-reference-004>ProjectResponseSchema.parse(
      await http.get<unknown>(`${EXTERNAL_BASE}/projects/${encodeURIComponent(projectId)}`),
    ).project,

    listMembers: async (projectId: string): Promise<<private-reference-004>ProjectMember[]> => {
      const project = <private-reference-004>ProjectResponseSchema.parse(
        await http.get<unknown>(`${EXTERNAL_BASE}/projects/${encodeURIComponent(projectId)}`),
      ).project;
      return project.members;
    },
  };
}

export type <private-reference-004>Client = ReturnType<typeof make<private-reference-004>Client>;
