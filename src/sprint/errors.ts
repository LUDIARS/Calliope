// Sprint エンジン共通のエラー型。 engine.ts (Actio PM scope) / projecthub-engine.ts (projecthub:<id> scope)
// の両方から使われるため、循環 import を避けて独立ファイルに置く。

export class SprintPrerequisiteError extends Error {
  constructor(public missing: string[]) {
    super(`sprint prerequisites missing: ${missing.join(', ')}`);
    this.name = 'SprintPrerequisiteError';
  }
}
