import { z } from 'zod';

const number = z.number();
const nullable = z.number().nullable();

const totals = z.object({
  tasks: number,
  attempts: number,
  inputTokens: number,
  outputTokens: number,
  tokens: number,
  costUsd: nullable,
  attemptsWithoutCost: number,
  agentMs: number,
  commandMs: number,
  wallMs: number,
});

const stat = z.object({ mean: number, median: number });
const costStat = z.object({ mean: nullable, median: nullable });

const perTask = z.object({ tokens: stat, costUsd: costStat, agentMs: stat, wallMs: stat });

const breakdown = z.object({
  key: z.string(),
  attempts: number,
  inputTokens: number,
  outputTokens: number,
  tokens: number,
  costUsd: nullable,
  agentMs: number,
  tokensPerAttempt: number,
});

const seriesProject = z.object({
  repository: z.string(),
  tokens: number,
  costUsd: nullable,
  agentMs: number,
  tasks: number,
});

const seriesModel = z.object({
  model: z.string(),
  tokens: number,
  costUsd: nullable,
  agentMs: number,
  attempts: number,
});

/** The report of `stats_report`; the type is `StatsReport` of the `stats` feature. */
export const statsReportSchema = z.object({
  settings: z.object({
    enabled: z.boolean(),
    exclude: z.array(z.string()),
    showCost: z.boolean(),
    backfilledAt: nullable,
  }),
  since: nullable,
  until: nullable,
  repository: z.string().nullable(),
  totals,
  perTask,
  outcomes: z.object({ finished: number, failed: number, cancelled: number }),
  projects: z.array(z.object({ repository: z.string(), totals, perTask })),
  bySpecialist: z.array(breakdown),
  byModel: z.array(breakdown),
  byPipeline: z.array(breakdown),
  byRuntime: z.array(breakdown),
  series: z.array(
    z.object({
      day: z.string(),
      start: number,
      tokens: number,
      costUsd: nullable,
      agentMs: number,
      tasks: number,
      projects: z.array(seriesProject),
      models: z.array(seriesModel),
    }),
  ),
});

export type StatsReportView = z.infer<typeof statsReportSchema>;

/** The answer of `stats_clear`. */
export const statsClearSchema = z.object({ removed: number });

export type StatsClearView = z.infer<typeof statsClearSchema>;
