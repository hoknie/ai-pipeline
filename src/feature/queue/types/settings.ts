import { rejected } from '../../../platform/errors/index.ts';
import {
  type OnLimit,
  type RunState,
  ON_LIMIT_MODES,
  RECOMMENDATION_LIMIT,
} from '../../runs/types/index.ts';
import { type QueueFilterPatch, checkQueueFilter, setQueueFilter } from './filter.ts';
import { type Queue, QUEUE_PARALLEL_MAX, queueStates } from './items.ts';
import { problemKeys } from './limit-hits.ts';

/** The most answers in a row the autopilot gives to one group. */
export const AUTOPILOT_ANSWERS_MAX = 3;

/** The answer of the autopilot when the queue has no text of its own. */
export const DEFAULT_AUTOPILOT_ANSWER =
  'I agree with your recommendations; go ahead with them. Where you gave no recommendation, choose the option you consider best and continue without asking again.';

function checkParallel(parallel: number): void {
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > QUEUE_PARALLEL_MAX) {
    throw rejected(`parallel must be an integer from 1 to ${QUEUE_PARALLEL_MAX}`);
  }
}

export function setParallel(queue: Queue, parallel: number, now: number): void {
  checkParallel(parallel);
  queue.parallel = parallel;
  queue.updatedAt = now;
}

export interface QueueSettingsPatch {
  parallel?: number | undefined;
  autopilot?: boolean | undefined;
  autoAnswer?: boolean | undefined;
  skipFailed?: boolean | undefined;
  /** `null`: the default text. */
  autopilotAnswer?: string | null | undefined;
  onLimit?: OnLimit | undefined;
  /** Replaces the passed lists of the take filter; only while the queue is stopped. */
  filter?: QueueFilterPatch | undefined;
}

function cleanAnswer(answer: string | null): string | null {
  if (answer === null) return null;
  const trimmed = answer.trim();
  if (trimmed === '') throw rejected('autopilot answer must not be empty');
  if ([...trimmed].length > RECOMMENDATION_LIMIT) {
    throw rejected(`autopilot answer must be at most ${RECOMMENDATION_LIMIT} characters`);
  }
  return trimmed;
}

/** Changes only the passed settings; the state of the queue stays as is. */
export function setQueueSettings(queue: Queue, patch: QueueSettingsPatch, now: number): void {
  if (
    patch.parallel === undefined &&
    patch.autopilot === undefined &&
    patch.autoAnswer === undefined &&
    patch.skipFailed === undefined &&
    patch.autopilotAnswer === undefined &&
    patch.onLimit === undefined &&
    patch.filter === undefined
  ) {
    throw rejected(
      'pass parallel, autopilot, autoAnswer, autopilotAnswer, skipFailed, onLimit or filter',
    );
  }
  if (patch.onLimit !== undefined && !ON_LIMIT_MODES.includes(patch.onLimit)) {
    throw rejected(`onLimit must be one of: ${ON_LIMIT_MODES.join(', ')}`);
  }
  const answer =
    patch.autopilotAnswer === undefined ? undefined : cleanAnswer(patch.autopilotAnswer);
  if (patch.filter !== undefined) checkQueueFilter(queue, patch.filter);
  if (patch.parallel !== undefined) checkParallel(patch.parallel);
  if (patch.parallel !== undefined) setParallel(queue, patch.parallel, now);
  if (patch.autopilot !== undefined) queue.autopilot = patch.autopilot;
  if (patch.autoAnswer !== undefined) queue.autoAnswer = patch.autoAnswer;
  if (patch.skipFailed !== undefined) queue.skipFailed = patch.skipFailed;
  if (answer !== undefined) queue.autopilotAnswer = answer;
  if (patch.onLimit !== undefined) queue.onLimit = patch.onLimit;
  if (patch.filter !== undefined) setQueueFilter(queue, patch.filter, now);
  queue.updatedAt = now;
}

/** Stops the queue; a queue stopped by a usage limit no longer starts by itself. */
export function pauseQueue(queue: Queue, now: number): void {
  queue.status = 'stopped';
  if (queue.stop?.kind === 'limit') queue.stop = { ...queue.stop, autoResume: false };
  queue.updatedAt = now;
}

/** When a queue stopped by a usage limit starts by itself; null when it does not. */
export function queueWakeAt(queue: Queue): number | null {
  return queue.status === 'stopped' && queue.stop?.kind === 'limit' && queue.stop.autoResume
    ? queue.stop.resetsAt
    : null;
}

export interface AutopilotAnswer {
  run: string;
  group: string;
  answer: string;
}

function autopilotStreak(decisions: readonly { by: string }[]): number {
  let streak = 0;
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    if (decisions[index]?.by !== 'autopilot') break;
    streak += 1;
  }
  return streak;
}

/**
 * Questions the queue answers now (when `autoAnswer` is on): groups of the runs that hold a place in a
 * running queue, waiting because the specialist reported `needs_human` (not
 * because of a limit or a change outside the worktree), that got fewer than
 * `AUTOPILOT_ANSWERS_MAX` autopilot answers in a row.
 */
export function autopilotAnswers(queue: Queue, states: Iterable<RunState>): AutopilotAnswer[] {
  if (queue.status !== 'running' || !queue.autoAnswer) return [];
  const answer = queue.autopilotAnswer ?? DEFAULT_AUTOPILOT_ANSWER;
  const result: AutopilotAnswer[] = [];
  for (const state of queueStates(queue, states)) {
    const work = state.split ? [state.split, ...state.groups] : state.groups;
    for (const group of work) {
      if (group.status !== 'needs_human' || group.humanOnly) continue;
      const last = group.attempts.at(-1);
      if (last?.report?.verdict !== 'needs_human' || last.outsideChanges.length > 0) continue;
      if (autopilotStreak(group.decisions) >= AUTOPILOT_ANSWERS_MAX) continue;
      result.push({ run: state.run.id, group: group.slug, answer });
    }
  }
  return result;
}

/** Starts the queue; the problems that exist now become known. */
export function startQueue(queue: Queue, states: Iterable<RunState>, now: number): void {
  queue.status = 'running';
  queue.stop = null;
  for (const item of queue.items) item.error = null;
  const known = new Set(queue.acknowledged);
  for (const state of queueStates(queue, states)) {
    for (const key of problemKeys(state)) known.add(key);
  }
  queue.acknowledged = [...known];
  queue.updatedAt = now;
}
