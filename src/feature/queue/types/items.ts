import { rejected } from '../../../platform/errors/index.ts';
import type { NewGroup, OnLimit, ProblemReason, RunState } from '../../runs/types/index.ts';
import type { DeliveryMode } from '../../swarm-config/types/index.ts';
import { queueItemId } from './ids.ts';

export const QUEUE_PARALLEL_MAX = 20;

/** The most runs the queue remembers as skipped. */
export const QUEUE_SKIPPED_MAX = 10;

export interface QueueItem {
  id: string;
  /** Integer number of the task within the repository; never reused. */
  number: number;
  pipeline: string;
  /** Id of a variant of the pipeline; `default` is the pipeline as it is. */
  variant: string;
  task: string | null;
  groups: NewGroup[] | null;
  title: string | null;
  /** `null`: follow `delivery.auto` when the task starts. */
  autoDeliver: boolean | null;
  /** `null`: follow `delivery.mode` when the task starts. */
  deliveryMode: DeliveryMode | null;
  /** Ids of catalog tags. */
  tags: string[];
  /** Ids of pipeline steps the task skips. */
  skip: string[];
  /** Ids of queue items or runs of the repository that must be done first. */
  after: string[];
  /** A running queue does not take a postponed item; the user starts it or clears the flag. */
  postponed: boolean;
  createdAt: number;
  error: string | null;
  /** A returned run: taking the item retries this run instead of creating one. */
  run: string | null;
}

export type QueueStop =
  | { kind: 'problem'; run: string; group: string | null; reason: ProblemReason }
  | { kind: 'item'; item: string; error: string }
  | {
      kind: 'limit';
      run: string;
      group: string;
      runtime: string;
      /** When the limit resets (ms). */
      resetsAt: number;
      /** The queue starts by itself at `resetsAt`. */
      autoResume: boolean;
    };

/** What a running queue takes; an empty list means any. */
export interface QueueFilter {
  /** Ids of pipelines. */
  pipelines: string[];
  /** Ids of catalog tags; a task needs at least one of them. */
  tags: string[];
}

export interface Queue {
  repository: string;
  status: 'stopped' | 'running';
  parallel: number;
  /** A running queue does not stop when it becomes empty. */
  autopilot: boolean;
  /** A running queue answers the questions of specialists with the autopilot answer. */
  autoAnswer: boolean;
  /** A run with a stopping problem leaves its place and the queue goes on. */
  skipFailed: boolean;
  /** Text the autopilot answers the questions of specialists with; `null`: the default text. */
  autopilotAnswer: string | null;
  /** What a usage limit does: the group waits for the reset, or fails. */
  onLimit: OnLimit;
  /** Which new items a running queue takes; changed only while the queue is stopped. */
  filter: QueueFilter;
  items: QueueItem[];
  /** The number the next added task gets. */
  nextNumber: number;
  /** Runs created by the queue that still occupy a place. */
  runs: string[];
  /** Runs that took a place by a priority action; they are not frozen for another one. */
  priority: string[];
  /** Keys of the problems the user already knows about. */
  acknowledged: string[];
  /** Runs taken off the places because of a stopping problem, the latest first. */
  skipped: string[];
  stop: QueueStop | null;
  updatedAt: number;
}

export interface ItemFields {
  pipeline: string;
  variant?: string | undefined;
  task?: string | undefined;
  groups?: NewGroup[] | undefined;
  title?: string | null | undefined;
  autoDeliver?: boolean | undefined;
  deliveryMode?: DeliveryMode | undefined;
  tags?: string[] | undefined;
  skip?: string[] | undefined;
  after?: string[] | undefined;
  postponed?: boolean | undefined;
}

export function emptyQueue(repository: string, now: number, nextNumber = 1): Queue {
  return {
    repository,
    status: 'stopped',
    parallel: 1,
    autopilot: false,
    autoAnswer: false,
    skipFailed: false,
    autopilotAnswer: null,
    onLimit: 'wait',
    filter: { pipelines: [], tags: [] },
    items: [],
    nextNumber,
    runs: [],
    priority: [],
    acknowledged: [],
    skipped: [],
    stop: null,
    updatedAt: now,
  };
}

/** An id for a return item made by the queue itself; free among the items. */
export function newItemId(queue: Queue, now: number): string {
  let random = queue.items.length;
  let id = queueItemId(now, random);
  while (queue.items.some((item) => item.id === id)) {
    random += 1;
    id = queueItemId(now, random);
  }
  return id;
}

export function findItem(queue: Queue, id: string): QueueItem {
  const item = queue.items.find((candidate) => candidate.id === id);
  if (!item) throw rejected('unknown queue item');
  return item;
}

export function queueStates(queue: Queue, states: Iterable<RunState>): RunState[] {
  const wanted = new Set(queue.runs);
  return [...states].filter((state) => wanted.has(state.run.id));
}
