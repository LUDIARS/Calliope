export type TaskRef =
  | { source: 'actio'; taskId: string }
  | { source: 'actio-pm'; projectId: string; externalId: string };

function requireRefPart(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes(':') || normalized.includes('/')) {
    throw new Error(`invalid ${label} for task_ref: ${value}`);
  }
  return normalized;
}

export function makeTaskRef(source: 'actio', taskId: string): string;
export function makeTaskRef(source: 'actio-pm', projectId: string, externalId: string): string;
export function makeTaskRef(source: 'actio' | 'actio-pm', ...ids: string[]): string {
  if (source === 'actio' && ids.length === 1) {
    return `actio:${requireRefPart(ids[0] ?? '', 'task id')}`;
  }
  if (source === 'actio-pm' && ids.length === 2) {
    const projectId = requireRefPart(ids[0] ?? '', 'project id');
    const externalId = requireRefPart(ids[1] ?? '', 'external id');
    return `actio-pm:${projectId}/${externalId}`;
  }
  throw new Error(`invalid task_ref arguments for source ${source}`);
}

export function parseTaskRef(ref: string): TaskRef {
  const actio = /^actio:([^:/]+)$/.exec(ref);
  if (actio?.[1]) return { source: 'actio', taskId: actio[1] };

  const pm = /^actio-pm:([^:/]+)\/([^/]+)$/.exec(ref);
  if (pm?.[1] && pm[2]) {
    return { source: 'actio-pm', projectId: pm[1], externalId: pm[2] };
  }
  throw new Error(`invalid task_ref: ${ref}`);
}

// <private-reference-004> プロジェクトスコープ (docs/design/<private-reference-004>-pm.md §H3)。 <private-reference-004> の projects
// レジストリを Calliope の project scope (priority/plan/sprint/risk が既に
// 使う自由形式の projectRef 文字列) に `<private-reference-004>:<project_id>` の形で載せる。
// taskRef (上記) とは別体系: taskRef は「タスク行の所有システム」を指し、
// <private-reference-004> 紐付けタスクの実体は引き続き Actio コアの taskRef (`actio:<id>`) を使う。
// projectRef は「優先度解決・plan/sprint/risk の集計単位」を指す。

export interface <private-reference-004>ProjectRef {
  source: '<private-reference-004>';
  projectId: string;
}

export function make<private-reference-004>ProjectRef(projectId: string): string {
  return `<private-reference-004>:${requireRefPart(projectId, '<private-reference-004> project id')}`;
}

export function parse<private-reference-004>ProjectRef(ref: string): <private-reference-004>ProjectRef | null {
  const match = /^<private-reference-004>:([^:/]+)$/.exec(ref);
  return match?.[1] ? { source: '<private-reference-004>', projectId: match[1] } : null;
}

export function is<private-reference-004>ProjectRef(ref: string): boolean {
  return ref.startsWith('<private-reference-004>:');
}
