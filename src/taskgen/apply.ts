import type { ActioClient } from '../clients/actio.ts';
import { makeTaskRef } from '../refs.ts';
import type { TaskCreateConfirmationPayload } from './payload.ts';

/**
 * 承認された候補だけを Actio へ起票する。 external_id を候補 key から決定的に
 * 導出するため、 同じ候補の再実行は Actio 側でも冪等になる。
 *
 * @spec POST /api/confirmations/:id (kind: task_create)
 */

export interface CandidateOutcome {
  key: string;
  source: string;
  status: 'created';
  taskId: string;
  taskRef: string;
  title: string;
}

export interface ApplyTaskCreateResult {
  outcomes: CandidateOutcome[];
}

/**
 * 承認済みの生成候補を Actio へ起票する (#529 write client `createTask`)。
 * external_id は候補 key から決定的に導出済みのため、 Actio 側でも再実行が冪等になる。
 * 無言フォールバック禁止: Actio の 4xx/5xx はここで throw され、 route が 502 に写す。
 */
export async function applyTaskCreateCandidates(
  actio: ActioClient,
  candidates: TaskCreateConfirmationPayload['candidates'],
): Promise<ApplyTaskCreateResult> {
  const outcomes: CandidateOutcome[] = [];
  for (const candidate of candidates) {
    const created = await actio.createTask({
      external_id: candidate.externalId,
      title: candidate.title,
      details: `[calliope:${candidate.source}] ${candidate.reason}`,
      status: 'open',
      due_at: candidate.dueAt,
      kind: 'task',
      category: candidate.category,
      creator_type: 'ai',
    });
    outcomes.push({
      key: candidate.key,
      source: candidate.source,
      status: 'created',
      taskId: created.id,
      taskRef: makeTaskRef('actio', created.id),
      title: created.title,
    });
  }
  return { outcomes };
}
