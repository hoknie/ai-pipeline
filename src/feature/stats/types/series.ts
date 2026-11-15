import { COMMAND_RUNTIME } from '../../runs/types/index.ts';
import { type AttemptRecord, type TaskRecord } from './records.ts';
import {
  type SeriesDay,
  type SeriesModel,
  type StatsBucket,
  type StatsBucketRequest,
  UNKNOWN_MODEL,
} from './report.ts';

const DAY_MS = 86_400_000;
const SIX_HOURS_MS = 6 * 3_600_000;
const WEEK_MS = 7 * DAY_MS;

export function resolveBucket(
  start: number | null,
  end: number | null,
  requested?: StatsBucketRequest,
): StatsBucket {
  if (requested === '6h' || requested === 'day' || requested === 'week') {
    return requested;
  }
  if (requested === 'auto') {
    if (start === null || end === null) return 'day';
    const span = Math.max(0, end - start);
    if (span <= 10 * DAY_MS) return '6h';
    if (span <= 120 * DAY_MS) return 'day';
    return 'week';
  }
  return 'day';
}

const pad = (value: number): string => String(value).padStart(2, '0');

export function startOf6h(ms: number): number {
  const date = new Date(ms);
  const slot = Math.floor(date.getHours() / 6) * 6;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), slot).getTime();
}

export function next6h(ms: number): number {
  const date = new Date(ms);
  const next = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours() + 6,
  ).getTime();
  return next > ms ? next : ms + SIX_HOURS_MS;
}

export function key6h(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}

export function startOfDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function nextDay(ms: number): number {
  const date = new Date(ms);
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  return next > ms ? next : ms + DAY_MS;
}

export function keyDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startOfWeek(ms: number): number {
  const date = new Date(ms);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - diff).getTime();
}

export function nextWeek(ms: number): number {
  const date = new Date(ms);
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7).getTime();
  return next > ms ? next : ms + WEEK_MS;
}

export function keyWeek(ms: number): string {
  return keyDay(startOfWeek(ms));
}

export const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

export const tokensOf = (record: AttemptRecord): number => record.inputTokens + record.outputTokens;

export const isAgent = (record: AttemptRecord): boolean => record.runtime !== COMMAND_RUNTIME;

export const durationOf = (record: AttemptRecord): number => record.durationMs;

export const agentMsOf = (records: AttemptRecord[]): number =>
  sum(records.filter((record) => record.kind === 'step' && isAgent(record)).map(durationOf));

export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return groups;
}

export function modelsOf(records: AttemptRecord[]): SeriesModel[] {
  return [...groupBy(records, (record) => record.model ?? UNKNOWN_MODEL)]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([model, own]) => ({
      model,
      tokens: sum(own.map(tokensOf)),
      agentMs: agentMsOf(own),
      attempts: own.length,
    }));
}

interface BucketStrategy {
  start: (ms: number) => number;
  next: (ms: number) => number;
  key: (ms: number) => string;
  recordKey: (ms: number) => string;
}

const STRATEGIES: Record<StatsBucket, BucketStrategy> = {
  '6h': {
    start: startOf6h,
    next: next6h,
    key: key6h,
    recordKey: (ms) => key6h(startOf6h(ms)),
  },
  day: {
    start: startOfDay,
    next: nextDay,
    key: keyDay,
    recordKey: keyDay,
  },
  week: {
    start: startOfWeek,
    next: nextWeek,
    key: keyWeek,
    recordKey: keyWeek,
  },
};

export function bucketSeries(
  attempts: AttemptRecord[],
  tasks: TaskRecord[],
  start: number,
  end: number,
  bucket: StatsBucket,
): SeriesDay[] {
  const strategy = STRATEGIES[bucket] ?? STRATEGIES.day;
  const attemptBuckets = groupBy(attempts, (record) => strategy.recordKey(record.finishedAt));
  const taskBuckets = groupBy(tasks, (task) => strategy.recordKey(task.finishedAt));
  const items: SeriesDay[] = [];
  const last = strategy.start(end);
  for (let cursor = strategy.start(start); cursor <= last; cursor = strategy.next(cursor)) {
    const day = strategy.key(cursor);
    const records = attemptBuckets.get(day) ?? [];
    const finished = taskBuckets.get(day) ?? [];
    const repositories = [...new Set([...records, ...finished].map((item) => item.repository))];
    items.push({
      day,
      start: cursor,
      tokens: sum(records.map(tokensOf)),
      agentMs: agentMsOf(records),
      tasks: finished.length,
      projects: repositories.sort().map((repository) => {
        const own = records.filter((record) => record.repository === repository);
        return {
          repository,
          tokens: sum(own.map(tokensOf)),
          agentMs: agentMsOf(own),
          tasks: finished.filter((task) => task.repository === repository).length,
        };
      }),
      models: modelsOf(records),
    });
  }
  return items;
}
