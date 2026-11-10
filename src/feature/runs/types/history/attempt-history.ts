import type { Usage, Verdict } from '../../../agents/types/index.ts';
import type { AttemptRuntime, AttemptStatus } from '../constants.ts';

export type AttemptHistoryResult = 'running' | Verdict | 'failed' | 'cancelled' | 'unknown';

export interface AttemptHistoryQuery {
  group: string;
  repository?: string;
  runtime?: string;
  model?: string;
  result?: AttemptHistoryResult;
  from?: number;
  to?: number;
  limit: 20 | 50 | 100;
  cursor?: AttemptHistoryCursor;
}

export interface AttemptHistoryCursor {
  startedAt: number;
  runId: string;
  seq: number;
}

export interface AttemptHistoryItem {
  id: string;
  runId: string;
  runNumber: number;
  runTitle: string;
  repository: string;
  attemptSeq: number;
  runtime: AttemptRuntime;
  model: string | null;
  startedAt: number;
  finishedAt: number | null;
  status: AttemptStatus;
  verdict: Verdict | null;
  result: AttemptHistoryResult;
  failureKind: string | null;
  usage: Usage | null;
}

export interface AttemptHistoryPage {
  items: AttemptHistoryItem[];
  nextCursor: AttemptHistoryCursor | null;
  projects: string[];
}

export function attemptHistoryResult(
  status: AttemptStatus,
  verdict: Verdict | null,
): AttemptHistoryResult {
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return verdict ?? 'unknown';
}

export function attemptHistoryId(runId: string, seq: number): string {
  return `${runId}:_repair:${seq}`;
}

export function attemptHistoryTitle(title: string | null, name: string | null, id: string): string {
  return title || name || id;
}
