import { z } from 'zod';

/**
 * `value` fields are numeric strings (Postgres numeric → string in Drizzle).
 * Keeping them as strings on the wire means no float drift; the UI formats
 * them with the org currency. Counts are plain ints.
 */
export const dashboardKpisSchema = z.object({
  totalContacts: z.number().int().nonnegative(),
  totalCompanies: z.number().int().nonnegative(),
  openDeals: z.number().int().nonnegative(),
  openPipelineValue: z.string(),
  overdueTasks: z.number().int().nonnegative(),
  currency: z.string().min(3).max(3),
});

export const pipelineByStageRowSchema = z.object({
  stageId: z.string().uuid(),
  stageName: z.string(),
  value: z.string(),
  dealCount: z.number().int().nonnegative(),
});

export const dealsTrendRowSchema = z.object({
  /** ISO date string for the first day of the month, e.g. '2026-01-01'. */
  month: z.string(),
  won: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  wonValue: z.string(),
  lostValue: z.string(),
});

export const activityVolumeRowSchema = z.object({
  /** ISO date string for the Monday of the week. */
  weekStart: z.string(),
  count: z.number().int().nonnegative(),
});

export const topOpenDealRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  value: z.string(),
  currency: z.string().min(3).max(3),
  stageName: z.string(),
  companyName: z.string().nullable(),
});

export const dashboardResponseSchema = z.object({
  kpis: dashboardKpisSchema,
  pipelineByStage: z.array(pipelineByStageRowSchema),
  dealsTrend: z.array(dealsTrendRowSchema),
  activityVolume: z.array(activityVolumeRowSchema),
  topOpenDeals: z.array(topOpenDealRowSchema),
});

export type DashboardKpis = z.infer<typeof dashboardKpisSchema>;
export type PipelineByStageRow = z.infer<typeof pipelineByStageRowSchema>;
export type DealsTrendRow = z.infer<typeof dealsTrendRowSchema>;
export type ActivityVolumeRow = z.infer<typeof activityVolumeRowSchema>;
export type TopOpenDealRow = z.infer<typeof topOpenDealRowSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
