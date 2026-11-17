import type { Attempt, FailReason, Group } from '../../types/index.ts';
import type { Ctx } from '../events.ts';

/**
 * Stops the running attempt of a group without a commit and queues the same step again without
 * the old session: the notes and the answer of the human stay, the partial edits stay in the tree.
 */
export function restartStep(m: Ctx, group: Group, running: Attempt, reason: FailReason): void {
  running.status = 'cancelled';
  running.reason = reason;
  running.finishedAt = m.now;
  m.effects.push({
    kind: 'stop_attempt',
    run: m.state.run.id,
    group: group.slug,
    seq: running.seq,
  });
  group.status = 'queued';
  group.pending = {
    stepIndex: running.stepIndex,
    feedback: running.input.feedback,
    humanAnswer: running.input.humanAnswer,
    resume: false,
    ...(running.input.reviewed ? { reviewed: true } : {}),
  };
}

/** A waiting group starts its step in a new session: no session and no runtime of the old one is kept. */
export function dropResume(group: Group): void {
  if (group.pending === null) return;
  const { keepRuntime: _keep, ...pending } = group.pending;
  group.pending = { ...pending, resume: false };
}
