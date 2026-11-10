import {
  REPAIR_GROUP,
  type AttemptHistoryItem,
  type AttemptHistoryQuery,
} from '../../runs/types/index.ts';
import type { RunsServices } from '../../runs/services/index.ts';
import { RUNTIMES } from '../../swarm-config/types/index.ts';

const HISTORY_RESULTS = [
  'running',
  'done',
  'rejected',
  'needs_human',
  'failed',
  'cancelled',
  'unknown',
] as const;

export interface ObserverHistoryQuery {
  repository?: string;
  runtime?: string;
  model?: string;
  result?: AttemptHistoryQuery['result'];
  from?: number;
  to?: number;
  limit?: number;
  cursor?: string;
}

export interface ObserverHistoryResponse {
  items: AttemptHistoryItem[];
  nextCursor: string | null;
  limit: 20 | 50 | 100;
  projects: string[];
  asOf: number;
}

export class ObserverHistoryService {
  private readonly runs: Pick<RunsServices, 'attemptHistory'>;
  private readonly now: () => number;

  constructor(runs: Pick<RunsServices, 'attemptHistory'>, now: () => number) {
    this.runs = runs;
    this.now = now;
  }

  page(input: ObserverHistoryQuery): ObserverHistoryResponse {
    const limit = input.limit ?? 20;
    if (limit !== 20 && limit !== 50 && limit !== 100) throw new Error('invalid history limit');
    if (input.repository !== undefined && (input.repository.length > 4096 || !input.repository))
      throw new Error('invalid repository');
    if (input.runtime !== undefined && !(RUNTIMES as readonly string[]).includes(input.runtime))
      throw new Error('invalid runtime');
    if (
      input.result !== undefined &&
      !(HISTORY_RESULTS as readonly string[]).includes(input.result)
    )
      throw new Error('invalid result');
    if (input.model !== undefined && (!input.model || input.model.length > 512))
      throw new Error('invalid model');
    for (const value of [input.from, input.to]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
        throw new Error('invalid time');
    }
    if (input.from !== undefined && input.to !== undefined && input.from >= input.to)
      throw new Error('invalid range');
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const page = this.runs.attemptHistory.page({ ...input, group: REPAIR_GROUP, limit, cursor });
    return {
      items: page.items,
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      limit,
      projects: page.projects,
      asOf: this.now(),
    };
  }
}

export function encodeCursor(cursor: { startedAt: number; runId: string; seq: number }): string {
  return Buffer.from(JSON.stringify({ v: 1, ...cursor })).toString('base64url');
}

export function decodeCursor(value: string): { startedAt: number; runId: string; seq: number } {
  if (value.length > 2048) throw new Error('invalid cursor');
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object') throw new Error();
    const cursor = parsed as Record<string, unknown>;
    if (Object.keys(cursor).sort().join(',') !== 'runId,seq,startedAt,v') throw new Error();
    if (
      cursor.v !== 1 ||
      !Number.isSafeInteger(cursor.startedAt) ||
      Number(cursor.startedAt) < 0 ||
      typeof cursor.runId !== 'string' ||
      !cursor.runId ||
      !Number.isSafeInteger(cursor.seq) ||
      Number(cursor.seq) < 1
    )
      throw new Error();
    return { startedAt: Number(cursor.startedAt), runId: cursor.runId, seq: Number(cursor.seq) };
  } catch {
    throw new Error('invalid cursor');
  }
}
