import { isRejected } from '../../../platform/errors/index.ts';
import { addUsage } from '../../agents/types/index.ts';
import { type RunState, isRunFinished, pointStalled, retryableGroups } from '../types/index.ts';
import {
  answerQuestion,
  messageAttempt,
  proposeSplit,
  recordUsage,
  reportAttempt,
} from './answers.ts';
import { afterDeliveryDone, markDelivered } from './delivery-checks.ts';
import {
  advanceChecks,
  finishDelivery,
  requestDelivery,
  resolvePrepared,
} from './delivery-flow.ts';
import type { Ctx, Effect, Event } from './events.ts';
import { attemptExited } from './exits.ts';
import { repairAllowed, repairStart } from './repair.ts';
import {
  cancelGroups,
  holdRun,
  interrupted,
  mergeFinished,
  retryGroup,
  startNextMerge,
} from './run-control.ts';
import { actionFinished, commitFailed, skipAhead, stepSkip, timedOut } from './steps.ts';

function updateFinished(state: RunState, now: number): void {
  if (!isRunFinished(state)) state.run.finishedAt = null;
  else if (state.run.finishedAt === null) state.run.finishedAt = now;
}

type Handlers = { [K in Event['kind']]: (m: Ctx, event: Extract<Event, { kind: K }>) => void };

function deliveryRequested(m: Ctx, event: Extract<Event, { kind: 'deliver_requested' }>): void {
  m.effects.push(
    ...requestDelivery(m.state, {
      groups: event.groups,
      force: event.force,
      files: event.files,
      auto: false,
    }),
  );
}

function runNamed(m: Ctx, event: Extract<Event, { kind: 'run_named' }>): void {
  if (m.state.run.title === null && event.title !== null) {
    m.state.run.title = event.title;
    m.state.run.name = event.name;
  }
  m.state.run.namingUsage = addUsage(m.state.run.namingUsage, event.usage);
}

/** The table of the events: one handler for each kind. */
const HANDLERS: Handlers = {
  report: (m, e) => reportAttempt(m, e.group, e.seq, e.report),
  split_proposed: (m, e) => proposeSplit(m, e.seq, e.groups),
  attempt_exited: (m, e) => attemptExited(m, e.group, e.seq, e.exit),
  attempt_usage: (m, e) => recordUsage(m, e.updates),
  timed_out: (m, e) => timedOut(m, e.group, e.seq),
  action_finished: (m, e) => actionFinished(m, e.group, e.seq, e.outcome),
  message: (m, e) => messageAttempt(m, e.group, e.seq, e.text),
  cancel: (m, e) => cancelGroups(m, e.group, e.reason),
  retry: (m, e) => retryGroup(m, e.group, e.permissions, e.specialists),
  answer: (m, e) => answerQuestion(m, e.group, e.answer, e.by ?? 'human', e.permissions),
  merge_finished: (m, e) => mergeFinished(m, e.group, e.outcome),
  commit_failed: (m, e) => commitFailed(m, e.group, e.message),
  deliver_requested: deliveryRequested,
  delivered_marked: (m, e) => void m.effects.push(...markDelivered(m.state, e.groups, m.now)),
  delivery_finished: (m, e) => void m.effects.push(...finishDelivery(m.state, e.result, m.now)),
  resolve_prepared: (m, e) => void m.effects.push(...resolvePrepared(m.state, e.conflicts)),
  run_named: runNamed,
  tags_set: (m, e) => void (m.state.run.tags = [...e.tags]),
  title_set: (m, e) => void (m.state.run.title = e.title),
  step_skip: (m, e) => stepSkip(m, e.step, e.skip),
  hold: (m, e) => holdRun(m, e.hold),
  repair_start: (m, e) => repairStart(m, e.incident, e.specialist),
  repair_allowed: (m, e) => repairAllowed(m, e.allowed),
  interrupted: (m) => interrupted(m),
};

function apply(m: Ctx, event: Event): void {
  (HANDLERS[event.kind] as (m: Ctx, event: Event) => void)(m, event);
}

/**
 * Moves the pipeline after an event: a delivery waits for the actions before it, and the run is
 * cleaned up once the actions after delivery are done.
 */
function movePipeline(m: Ctx, wasDone: boolean): void {
  m.effects.push(...advanceChecks(m.state));
  if (!wasDone && afterDeliveryDone(m.state) && !m.state.run.config.delivery.keep) {
    m.effects.push({ kind: 'cleanup', run: m.state.run.id });
  }
}

function autoDeliver(m: Ctx): void {
  // A check that failed or was cancelled stops the pipeline: only an explicit request starts it again.
  if (m.checksCancelled || pointStalled(m.state, 'before_delivery')) return;
  if (
    !m.state.groups.some((group) => group.status === 'merged' && group.delivery.state === 'pending')
  ) {
    return;
  }
  try {
    m.effects.push(
      ...requestDelivery(m.state, { groups: null, force: false, files: [], auto: true }),
    );
  } catch (error) {
    if (!isRejected(error)) throw error;
  }
}

export function transition(state: RunState, event: Event, now: number): Effect[] {
  const m: Ctx = { state, now, effects: [], checksCancelled: false, pausedRepair: false };
  const wasFinished = state.run.finishedAt !== null;
  const wasDone = afterDeliveryDone(state);
  const heldBefore = state.run.hold !== null;
  apply(m, event);
  movePipeline(m, wasDone);
  skipAhead(m);
  startNextMerge(m);
  updateFinished(state, now);
  // A pause cancelled the repair of a task with nothing to retry (a delivery incident): the pause
  // stays, or the incident would be taken again at once. A finished task that was held before the
  // event is such a task.
  const keepHold = m.pausedRepair || (wasFinished && heldBefore);
  if (state.run.finishedAt !== null && retryableGroups(state).length === 0 && !keepHold) {
    state.run.hold = null;
  }
  if (!wasFinished && state.run.finishedAt !== null && state.run.config.delivery.auto) {
    autoDeliver(m);
    updateFinished(state, now);
  }
  if (state.run.finishedAt !== null && retryableGroups(state).length === 0 && !keepHold) {
    state.run.hold = null;
  }
  return m.effects;
}
