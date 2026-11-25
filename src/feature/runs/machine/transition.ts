import { isRejected, rejected } from '../../../platform/errors/index.ts';
import { addUsage } from '../../agents/types/index.ts';
import {
  type PinnedSkill,
  type RunState,
  SPLIT_GROUP,
  isRunFinished,
  pointStalled,
  retryableGroups,
} from '../types/index.ts';
import {
  answerQuestion,
  messageAttempt,
  proposeSplit,
  recordUsage,
  registryProjectResolved,
  reportAttempt,
} from './answers.ts';
import { cleanRunMark, markCleanedByEffects, rejectCleaned } from './cleanup/index.ts';
import { afterDeliveryDone, markDelivered } from './delivery-checks.ts';
import {
  advanceChecks,
  finishDelivery,
  replyAsMessage,
  requestDelivery,
  resolvePrepared,
} from './delivery-flow.ts';
import { pushed, pushFailed, retryPush } from './push/index.ts';
import type { Ctx, Effect, Event } from './events.ts';
import { attemptExited } from './exits.ts';
import { repairAllowed, repairStart } from './repair.ts';
import {
  cancelAfterSplit,
  cancelGroups,
  holdRun,
  interrupted,
  mergeFinished,
  retryGroup,
  splitCommitted,
  timedOut,
} from './run-control.ts';
import { startNextMerge } from './scheduler.ts';
import { actionFinished, commitFailed, providerUnavailable, skipAhead, stepSkip } from './steps.ts';
import { setProvider } from './provider/index.ts';
import { setVariant } from './variant/index.ts';

function updateFinished(state: RunState, now: number): void {
  if (!isRunFinished(state)) state.run.finishedAt = null;
  else if (state.run.finishedAt === null) state.run.finishedAt = now;
}

type Handlers = { [K in Event['kind']]: (m: Ctx, event: Extract<Event, { kind: K }>) => void };

function deliveryRequested(m: Ctx, event: Extract<Event, { kind: 'deliver_requested' }>): void {
  rejectCleaned(m, 'deliver');
  const retry = retryPush(m.state, event.groups);
  if (retry !== null) {
    m.effects.push(...retry);
    return;
  }
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

/** The first version fixed for a skill wins: attempts of parallel groups may pin the same one. */
function pinSkills(m: Ctx, pins: Record<string, PinnedSkill>): void {
  const kept = { ...m.state.run.pinnedSkills };
  for (const [name, pin] of Object.entries(pins)) {
    if (!Object.hasOwn(kept, name))
      kept[name] = { version: pin.version, connection: pin.connection };
  }
  m.state.run.pinnedSkills = kept;
}

function autoDeliveryCancelled(m: Ctx): void {
  const run = m.state.run;
  if (run.finishedAt !== null) {
    throw rejected(`run ${run.id} is finished; its auto delivery already ran`);
  }
  if (!run.config.delivery.auto) throw rejected(`auto delivery of run ${run.id} is off`);
  run.config.delivery.auto = false;
}

/**
 * The commit of a step failed. The commit of the split takes its groups and the actions after them
 * away: nothing may start from a tree without the result of the split.
 */
function commitFailedEvent(m: Ctx, event: Extract<Event, { kind: 'commit_failed' }>): void {
  commitFailed(m, event.group, event.message);
  if (event.group === SPLIT_GROUP) cancelAfterSplit(m);
}

/** The table of the events: one handler for each kind. */
const HANDLERS: Handlers = {
  report: (m, e) => reportAttempt(m, e.group, e.seq, e.report),
  split_proposed: (m, e) => proposeSplit(m, e.seq, e.groups),
  attempt_exited: (m, e) => {
    replyAsMessage(m.state, e.group, e.seq, e.exit);
    attemptExited(m, e.group, e.seq, e.exit);
  },
  attempt_usage: (m, e) => recordUsage(m, e.updates),
  registry_project_resolved: (m, e) =>
    registryProjectResolved(m, e.group, e.seq, e.registryProject),
  timed_out: (m, e) => timedOut(m, e.group, e.seq),
  provider_unavailable: (m, e) => providerUnavailable(m, e.group, e.reason),
  action_finished: (m, e) => actionFinished(m, e.group, e.seq, e.outcome),
  message: (m, e) => messageAttempt(m, e.group, e.seq, e.text),
  cancel: (m, e) => cancelGroups(m, e.group, e.reason),
  retry: (m, e) => {
    rejectCleaned(m, 'retry');
    retryGroup(m, e.group, e.permissions, e.specialists);
    if (e.hold !== undefined) m.state.run.hold = e.hold;
  },
  answer: (m, e) => answerQuestion(m, e.group, e.answer, e.by ?? 'human', e.permissions),
  merge_finished: (m, e) => mergeFinished(m, e.group, e.outcome),
  commit_failed: commitFailedEvent,
  split_committed: (m, e) => splitCommitted(m, e.commit),
  deliver_requested: deliveryRequested,
  delivered_marked: (m, e) => void m.effects.push(...markDelivered(m.state, e.groups, m.now)),
  delivery_finished: (m, e) => void m.effects.push(...finishDelivery(m.state, e.result, m.now)),
  delivery_pushed: (m, e) => void m.effects.push(...pushed(m.state, e.remoteBranch)),
  delivery_push_failed: (m, e) => pushFailed(m.state, e.reason),
  resolve_prepared: (m, e) => void m.effects.push(...resolvePrepared(m.state, e.conflicts)),
  run_named: runNamed,
  tags_set: (m, e) => void (m.state.run.tags = [...e.tags]),
  title_set: (m, e) => void (m.state.run.title = e.title),
  auto_delivery_cancelled: autoDeliveryCancelled,
  step_skip: (m, e) => stepSkip(m, e.step, e.skip),
  variant_set: (m, e) => setVariant(m, e.variant, e.config),
  provider_set: (m, e) => setProvider(m, e.provider),
  hold: (m, e) => holdRun(m, e.hold),
  repair_start: (m, e) => repairStart(m, e.incident, e.specialist),
  repair_allowed: (m, e) => repairAllowed(m, e.allowed),
  skills_pinned: (m, e) => pinSkills(m, e.pins),
  clean: cleanRunMark,
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
  markCleanedByEffects(m, m.effects);
  return m.effects;
}
