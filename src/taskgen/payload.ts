import { z } from 'zod';

/**
 * task_create confirmation payload の境界スキーマ。
 * service (作成) / routes (承認起票) / briefing (サマリ表示) が共有する契約。
 * 個人データ非保持: 候補は task_ref / goal_ref 参照 + タイトル + 生成根拠のみ。
 *
 * @spec 保持しないもの
 */
export const taskCandidateSourceSchema = z.enum([
  'sprint_carryover',
  'risk_red',
  'plan_gap',
  'retrospective_action',
]);

export const taskCandidateSchema = z.object({
  key: z.string().min(1),
  source: taskCandidateSourceSchema,
  title: z.string().min(1),
  externalId: z.string().min(1),
  originTaskRef: z.string().nullable(),
  projectRef: z.string().nullable(),
  goalRef: z.string().nullable(),
  category: z.string().nullable(),
  dueAt: z.string().nullable(),
  reason: z.string(),
});

export const taskGenerationSummarySchema = z.object({
  sprintCarryover: z.number().int().nonnegative(),
  riskRed: z.number().int().nonnegative(),
  planGap: z.number().int().nonnegative(),
  retrospectiveAction: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
  suppressed: z.number().int().nonnegative(),
});

export const taskCreateConfirmationPayloadSchema = z.object({
  generatedAt: z.string(),
  summary: taskGenerationSummarySchema,
  candidates: z.array(taskCandidateSchema),
});

export type TaskCreateConfirmationPayload = z.infer<typeof taskCreateConfirmationPayloadSchema>;
export type TaskGenerationSummary = z.infer<typeof taskGenerationSummarySchema>;
