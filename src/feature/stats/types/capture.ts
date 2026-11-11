import {
  allGroups,
  describeFailReason,
  isRunFinished,
  runPhase,
  type RunState,
} from '../../runs/types/index.ts';
import { type AttemptRecord, type NamingRecord, type TaskRecord } from './records.ts';

export const NAMING_GROUP = '_naming';

export interface RunRecords {
  /** Finished attempts of every group, and the naming call when its usage is known. */
  attempts: AttemptRecord[];
  /** The task of a finished run; null while the run goes on. */
  task: TaskRecord | null;
}

/** What the journal can record from one saved state of a run. */
export function recordsOf(state: RunState): RunRecords {
  const { run } = state;
  const attempts: AttemptRecord[] = [];
  if (run.namingUsage !== null) attempts.push(namingRecord(state));
  for (const group of allGroups(state)) {
    for (const attempt of group.attempts) {
      if (attempt.status === 'running' || attempt.finishedAt === null) continue;
      attempts.push({
        runId: run.id,
        group: group.slug,
        seq: attempt.seq,
        kind: 'step',
        repository: run.repository,
        pipeline: run.pipeline,
        stepId: attempt.stepId,
        specialist: attempt.specialist,
        runtime: attempt.runtime,
        model: attempt.model,
        status: attempt.status,
        reason: attempt.reason === null ? null : describeFailReason(attempt.reason),
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        durationMs: Math.max(0, attempt.finishedAt - attempt.startedAt),
        inputTokens: attempt.usage?.inputTokens ?? 0,
        outputTokens: attempt.usage?.outputTokens ?? 0,
        costUsd: attempt.usage?.costUsd ?? null,
      });
    }
  }
  return { attempts, task: taskOf(state) };
}

function namingRecord(state: RunState): NamingRecord {
  const { run } = state;
  const usage = run.namingUsage;
  return {
    runId: run.id,
    group: NAMING_GROUP,
    seq: 0,
    kind: 'naming',
    repository: run.repository,
    pipeline: run.pipeline,
    stepId: 'naming',
    specialist: 'naming',
    runtime: run.config.naming.runtime,
    model: run.config.naming.model,
    status: 'finished',
    reason: null,
    startedAt: run.createdAt,
    finishedAt: run.createdAt,
    durationMs: 0,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    costUsd: usage?.costUsd ?? null,
  };
}

function taskOf(state: RunState): TaskRecord | null {
  const { run } = state;
  if (run.finishedAt === null || !isRunFinished(state)) return null;
  const phase = runPhase(state);
  if (phase !== 'finished' && phase !== 'failed' && phase !== 'cancelled') return null;
  return {
    runId: run.id,
    repository: run.repository,
    pipeline: run.pipeline,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    wallMs: Math.max(0, run.finishedAt - run.createdAt),
    outcome: phase,
  };
}
