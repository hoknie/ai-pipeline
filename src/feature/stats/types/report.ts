import { type StatsSettingsView } from './settings.ts';
import { type TaskOutcome } from './records.ts';

export type StatsBucket = '6h' | 'day' | 'week';
export type StatsBucketRequest = 'auto' | StatsBucket;

/** What a report covers; no `since` and `until` mean all time, no `repository` all projects. */
export interface StatsQuery {
  since?: number;
  until?: number;
  repository?: string;
  bucket?: StatsBucketRequest;
  /** Roots of the projects the report may cover; absent: all. */
  only?: readonly string[];
}

export interface Totals {
  tasks: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  /** Time of attempts of every runtime but `command`. */
  agentMs: number;
  /** Time of `command` attempts. */
  commandMs: number;
  /** Sum of the full times of the tasks. */
  wallMs: number;
}

export interface Stat {
  mean: number;
  median: number;
}

export interface PerTask {
  tokens: Stat;
  agentMs: Stat;
  wallMs: Stat;
}

export interface ProjectRow {
  repository: string;
  totals: Totals;
  perTask: PerTask;
}

export interface BreakdownRow {
  key: string;
  /** Display name from the configuration of the projects; null when there is none. */
  name: string | null;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  agentMs: number;
  /** Average tokens of one attempt. */
  tokensPerAttempt: number;
}

export interface SeriesProject {
  repository: string;
  tokens: number;
  agentMs: number;
  tasks: number;
}

/** The name of the model of attempts that carry none. */
export const UNKNOWN_MODEL = 'unknown';

export interface SeriesModel {
  model: string;
  tokens: number;
  agentMs: number;
  /** Attempts, not tasks: one task can run on several models. */
  attempts: number;
}

/** One local day; days without data have zeros and no projects. */
export interface SeriesDay {
  /** `YYYY-MM-DD`, in the local time of the daemon. */
  day: string;
  /** Start of the day, ms. */
  start: number;
  tokens: number;
  agentMs: number;
  tasks: number;
  projects: SeriesProject[];
  models: SeriesModel[];
}

export interface StatsReport {
  settings: StatsSettingsView;
  since: number | null;
  until: number | null;
  repository: string | null;
  bucket?: StatsBucket;
  totals: Totals;
  perTask: PerTask;
  outcomes: Record<TaskOutcome, number>;
  projects: ProjectRow[];
  bySpecialist: BreakdownRow[];
  byModel: BreakdownRow[];
  byPipeline: BreakdownRow[];
  byRuntime: BreakdownRow[];
  series: SeriesDay[];
}

const HOUR_MS = 3_600_000;

export type StatsPeriod = { ok: true; since: number | null } | { ok: false; error: string };

/** `<n>h`, `<n>d`, `<n>w` or `all`: the start of the period counted back from `now`; null for all. */
export function parseStatsPeriod(text: string, now: number): StatsPeriod {
  const trimmed = text.trim();
  if (trimmed === 'all') return { ok: true, since: null };
  const match = /^(\d+)([hdw])$/.exec(trimmed);
  const count = match ? Number(match[1]) : 0;
  if (!match || count < 1) {
    return { ok: false, error: `invalid period "${text}": use <n>h, <n>d, <n>w or all` };
  }
  const unit = match[2] ?? 'd';
  if (unit === 'h') return { ok: true, since: now - count * HOUR_MS };
  // Days and weeks start at local midnight, so the totals and the daily series cover the same days.
  const days = unit === 'w' ? count * 7 : count;
  const date = new Date(now);
  return {
    ok: true,
    since: new Date(date.getFullYear(), date.getMonth(), date.getDate() - (days - 1)).getTime(),
  };
}
