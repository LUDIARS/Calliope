export interface DagTask {
  taskRef: string;
  blockedBy: string[];
}

export class DagCycleError extends Error {
  constructor(public taskRefs: string[]) {
    super(`dependency cycle detected: ${taskRefs.join(' -> ')}`);
    this.name = 'DagCycleError';
  }
}

function findCycle(tasks: DagTask[]): string[] {
  const byRef = new Map(tasks.map((task) => [task.taskRef, task]));
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  function visit(ref: string): string[] | null {
    state.set(ref, 1);
    stack.push(ref);
    const task = byRef.get(ref);
    for (const dependency of task?.blockedBy ?? []) {
      if (!byRef.has(dependency)) continue;
      if (state.get(dependency) === 1) {
        const start = stack.indexOf(dependency);
        return [...stack.slice(start), dependency];
      }
      if ((state.get(dependency) ?? 0) === 0) {
        const cycle = visit(dependency);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(ref, 2);
    return null;
  }

  for (const task of tasks) {
    if ((state.get(task.taskRef) ?? 0) !== 0) continue;
    const cycle = visit(task.taskRef);
    if (cycle) return cycle;
  }
  return [];
}

export function topologicalSort<T extends DagTask>(tasks: T[]): T[] {
  const byRef = new Map(tasks.map((task) => [task.taskRef, task]));
  const order = new Map(tasks.map((task, index) => [task.taskRef, index]));
  const inDegree = new Map(tasks.map((task) => [
    task.taskRef,
    task.blockedBy.filter((dependency) => byRef.has(dependency)).length,
  ]));
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dependency of task.blockedBy) {
      if (!byRef.has(dependency)) continue;
      const values = dependents.get(dependency) ?? [];
      values.push(task.taskRef);
      dependents.set(dependency, values);
    }
  }

  const ready = tasks.filter((task) => inDegree.get(task.taskRef) === 0);
  const result: T[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => (order.get(a.taskRef) ?? 0) - (order.get(b.taskRef) ?? 0));
    const task = ready.shift();
    if (!task) break;
    result.push(task);
    for (const dependent of dependents.get(task.taskRef) ?? []) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) {
        const value = byRef.get(dependent);
        if (value) ready.push(value);
      }
    }
  }

  if (result.length !== tasks.length) throw new DagCycleError(findCycle(tasks));
  return result;
}
