import type { ActioClient } from '../clients/actio.ts';
import type { StocktakeConfirmationPayload } from './payload.ts';

export interface ProposalOutcome {
  action: 'close' | 'reprioritize' | 'merge';
  taskId?: string;
  taskIds?: string[];
  status: 'applied' | 'skipped';
  detail?: string;
}

export interface ApplyStocktakeResult {
  outcomes: ProposalOutcome[];
}

/**
 * 承認済み整理提案を Actio へ実行する。
 * - close → updateTaskStatus('done') / reprioritize → updateTaskPriority (#529 write client)。
 * - merge は提案のみ (実行しない): クラスタ統合は人間が Actio UI で行う。
 * 無言フォールバック禁止: Actio の 4xx/5xx はここで throw され、 route が 502 に写す。
 */
export async function applyStocktakeProposals(
  actio: ActioClient,
  proposals: StocktakeConfirmationPayload['proposals'],
): Promise<ApplyStocktakeResult> {
  const outcomes: ProposalOutcome[] = [];
  for (const proposal of proposals) {
    if (proposal.action === 'close') {
      await actio.updateTaskStatus(proposal.taskId, 'done');
      outcomes.push({ action: 'close', taskId: proposal.taskId, status: 'applied' });
    } else if (proposal.action === 'reprioritize') {
      await actio.updateTaskPriority(proposal.taskId, proposal.priority);
      outcomes.push({ action: 'reprioritize', taskId: proposal.taskId, status: 'applied' });
    } else {
      outcomes.push({
        action: 'merge',
        taskIds: proposal.taskIds,
        status: 'skipped',
        detail: 'merge is proposal-only; no execution',
      });
    }
  }
  return { outcomes };
}
