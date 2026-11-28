export type AttemptKind = 'step' | 'naming';

export type TaskOutcome = 'finished' | 'failed' | 'cancelled';

/** One finished attempt of a run, or the call that named the run (`kind: 'naming'`). */
export interface AttemptRecord {
  runId: string;
  group: string;
  seq: number;
  kind: AttemptKind;
  repository: string;
  pipeline: string;
  stepId: string;
  specialist: string;
  runtime: string;
  model: string | null;
  status: string;
  reason: string | null;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Id of the user who created the run; null: none. */
  author: string | null;
  /** The run is a probe: the report leaves the record out, the read by id keeps it. */
  isProbe: boolean;
}

export type NamingRecord = AttemptRecord & { kind: 'naming' };

/** A finished run: the unit the statistics call a task. */
export interface TaskRecord {
  runId: string;
  repository: string;
  pipeline: string;
  createdAt: number;
  finishedAt: number;
  wallMs: number;
  outcome: TaskOutcome;
  /** Id of the user who created the run; null: none. */
  author: string | null;
  /** The run is a probe: the report leaves the record out, the read by id keeps it. */
  isProbe: boolean;
}

/** Key of an attempt record inside a run. */
export function attemptKey(record: Pick<AttemptRecord, 'runId' | 'group' | 'seq'>): string {
  return `${record.runId}/${record.group}/${record.seq}`;
}
