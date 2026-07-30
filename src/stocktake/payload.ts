import { z } from 'zod';

/**
 * task_stocktake confirmation payload の境界スキーマ。
 * service (作成) / routes (承認実行) / briefing (サマリ表示) が共有する契約。
 * 個人データ非保持: 提案は task id 参照 + タイトルのみ (本文を載せない)。
 */
export const stocktakeActioPrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);

export const stocktakeProposalSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('close'),
    taskId: z.string().min(1),
    title: z.string(),
    reason: z.literal('done_candidate'),
  }),
  z.object({
    action: z.literal('reprioritize'),
    taskId: z.string().min(1),
    title: z.string(),
    priority: stocktakeActioPrioritySchema,
    reason: z.literal('priority_staleness'),
  }),
  z.object({
    action: z.literal('merge'),
    taskIds: z.array(z.string().min(1)).length(2),
    title: z.string(),
    reason: z.literal('duplicate_candidate'),
  }),
]);

export const stocktakeSummarySchema = z.object({
  aging: z.number().int().nonnegative(),
  doneCandidates: z.number().int().nonnegative(),
  duplicateCandidates: z.number().int().nonnegative(),
  priorityStaleness: z.number().int().nonnegative(),
  proposals: z.number().int().nonnegative(),
});

export const stocktakeConfirmationPayloadSchema = z.object({
  generatedAt: z.string(),
  summary: stocktakeSummarySchema,
  proposals: z.array(stocktakeProposalSchema),
});

export type StocktakeConfirmationPayload = z.infer<typeof stocktakeConfirmationPayloadSchema>;
export type StocktakeSummary = z.infer<typeof stocktakeSummarySchema>;
