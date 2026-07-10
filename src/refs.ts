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
