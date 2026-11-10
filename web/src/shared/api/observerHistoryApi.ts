import { ApiError, call } from './http.ts';

const HISTORY_RUNTIMES = ['claude', 'opencode', 'agy', 'command'] as const;
const ATTEMPT_STATUSES = ['running', 'finished', 'failed', 'cancelled'] as const;
const HISTORY_VERDICTS = ['done', 'rejected', 'needs_human'] as const;
const isDate = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  Number.isFinite(new Date(value as number).getTime());

export type HistoryResult =
  'running' | 'done' | 'rejected' | 'needs_human' | 'failed' | 'cancelled' | 'unknown';
export interface ObserverHistoryItem {
  id: string;
  runId: string;
  runNumber: number;
  runTitle: string;
  repository: string;
  attemptSeq: number;
  runtime: string;
  model: string | null;
  startedAt: number;
  finishedAt: number | null;
  status: string;
  verdict: string | null;
  result: HistoryResult;
  failureKind: string | null;
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null } | null;
}
export interface ObserverHistoryQuery {
  repository?: string;
  runtime?: string;
  model?: string;
  result?: HistoryResult;
  from?: number;
  to?: number;
  limit?: 20 | 50 | 100;
  cursor?: string;
}
export interface ObserverHistoryPage {
  items: ObserverHistoryItem[];
  nextCursor: string | null;
  limit: number;
  projects: string[];
  asOf: number;
}

function isPage(value: unknown): value is ObserverHistoryPage {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<ObserverHistoryPage>;
  const results: readonly string[] = [
    'running',
    'done',
    'rejected',
    'needs_human',
    'failed',
    'cancelled',
    'unknown',
  ];
  const nullableString = (v: unknown): boolean => v === null || typeof v === 'string';
  const validItem = (item: unknown): item is ObserverHistoryItem => {
    if (!item || typeof item !== 'object') return false;
    const i = item as Partial<ObserverHistoryItem>;
    return (
      typeof i.id === 'string' &&
      typeof i.runId === 'string' &&
      Number.isSafeInteger(i.runNumber) &&
      typeof i.runTitle === 'string' &&
      typeof i.repository === 'string' &&
      Number.isSafeInteger(i.attemptSeq) &&
      HISTORY_RUNTIMES.includes(i.runtime as (typeof HISTORY_RUNTIMES)[number]) &&
      nullableString(i.model) &&
      isDate(i.startedAt) &&
      (i.finishedAt === null || isDate(i.finishedAt)) &&
      ATTEMPT_STATUSES.includes(i.status as (typeof ATTEMPT_STATUSES)[number]) &&
      (i.verdict === null ||
        HISTORY_VERDICTS.includes(i.verdict as (typeof HISTORY_VERDICTS)[number])) &&
      results.includes(i.result ?? '') &&
      nullableString(i.failureKind) &&
      (i.usage === null ||
        (!!i.usage &&
          typeof i.usage === 'object' &&
          Number.isSafeInteger(i.usage.inputTokens) &&
          i.usage.inputTokens! >= 0 &&
          Number.isSafeInteger(i.usage.outputTokens) &&
          i.usage.outputTokens! >= 0 &&
          (i.usage.costUsd === null ||
            (typeof i.usage.costUsd === 'number' &&
              Number.isFinite(i.usage.costUsd) &&
              i.usage.costUsd >= 0))))
    );
  };
  return (
    Array.isArray(page.items) &&
    Array.isArray(page.projects) &&
    page.projects.every((project) => typeof project === 'string') &&
    (page.nextCursor === null || typeof page.nextCursor === 'string') &&
    [20, 50, 100].includes(page.limit ?? 0) &&
    isDate(page.asOf) &&
    page.items.every(validItem)
  );
}

export async function observerHistory(
  query: ObserverHistoryQuery = {},
): Promise<ObserverHistoryPage> {
  const params = new URLSearchParams();
  for (const key of [
    'repository',
    'runtime',
    'model',
    'result',
    'from',
    'to',
    'limit',
    'cursor',
  ] as const) {
    const value = query[key];
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const body = await call<unknown>(`/api/observers/history${params.size ? `?${params}` : ''}`);
  if (!isPage(body)) throw new ApiError(502, 'Malformed answer of /api/observers/history');
  return body;
}

export const historyQueryString = (query: ObserverHistoryQuery): string => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return params.toString();
};
