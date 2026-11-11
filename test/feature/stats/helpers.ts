import type { Usage } from '../../../src/feature/agents/types/index.ts';
import { type RunState } from '../../../src/feature/runs/types/index.ts';
import { type AttemptRecord, type TaskRecord } from '../../../src/feature/stats/types/index.ts';
import { group, run, step } from '../runs/helpers.ts';

export interface AttemptSpec {
  startedAt: number;
  finishedAt: number | null;
  usage?: Usage | null;
  runtime?: 'claude' | 'opencode' | 'agy' | 'command';
  model?: string | null;
  specialist?: string;
}

/** A run of one group whose attempts are the given ones; the run is not finished. */
export function runWith(
  id: string,
  attempts: AttemptSpec[],
  options: { repository?: string; createdAt?: number } = {},
): RunState {
  const state = run(1, { id, now: options.createdAt ?? 1000 });
  state.run.repository = options.repository ?? '/repo';
  step(state, 1500);
  const target = group(state);
  const first = target.attempts[0]!;
  target.attempts = attempts.map((spec, index) => ({
    ...first,
    seq: index + 1,
    status: spec.finishedAt === null ? 'running' : 'finished',
    startedAt: spec.startedAt,
    finishedAt: spec.finishedAt,
    usage: spec.usage ?? null,
    runtime: spec.runtime ?? 'claude',
    model: spec.model === undefined ? 'sonnet' : spec.model,
    specialist: spec.specialist ?? 'coder',
  }));
  return state;
}

/** Marks the run finished the way the machine does: every group settled and `finishedAt` set. */
export function settle(
  state: RunState,
  outcome: 'merged' | 'failed' | 'cancelled',
  finishedAt: number,
): RunState {
  group(state).status = outcome;
  state.run.finishedAt = finishedAt;
  return state;
}

export function usage(input: number, output: number, costUsd: number | null = null): Usage {
  return { inputTokens: input, outputTokens: output, costUsd };
}

let counter = 0;

export function attemptRecord(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  counter += 1;
  return {
    runId: `run-${counter}`,
    group: 'gruppa-1',
    seq: 1,
    kind: 'step',
    repository: '/work/app',
    pipeline: 'feature',
    stepId: 'code',
    specialist: 'coder',
    runtime: 'claude',
    model: 'sonnet',
    status: 'finished',
    reason: null,
    startedAt: 1000,
    finishedAt: 2000,
    durationMs: 1000,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.1,
    ...overrides,
  };
}

export function taskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  counter += 1;
  return {
    runId: `run-${counter}`,
    repository: '/work/app',
    pipeline: 'feature',
    createdAt: 1000,
    finishedAt: 5000,
    wallMs: 4000,
    outcome: 'finished',
    ...overrides,
  };
}
