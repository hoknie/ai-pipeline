import type { NewGroup, RunCreated } from '../../runs/types/index.ts';
import type { DeliveryMode } from '../../swarm-config/types/index.ts';

import type { ItemPatch } from './edit.ts';
import type { Queue } from './items.ts';

/** The task of a queue item as a client or a specialist describes it. */
export interface TaskFields {
  pipeline: string;
  /** Id of a variant of the pipeline; absent: `default`. */
  variant?: string | undefined;
  task?: string | undefined;
  groups?: NewGroup[] | undefined;
  title?: string | undefined;
  autoDeliver?: boolean | undefined;
  deliveryMode?: DeliveryMode | undefined;
  skip?: string[] | undefined;
  /** Ids of queue items or runs this task waits for. */
  after?: string[] | undefined;
}

/** `run` and `queue_add`: a task for the queue of a repository. */
export interface QueueAddRequest extends TaskFields {
  repository: string;
  /** Tag names of the catalog. */
  tags?: string[] | undefined;
  /** The run (id or task number) whose linked task tag the new task carries. */
  parent?: string | number | undefined;
  postponed?: boolean | undefined;
}

/** `worker_queue_add`: a task a specialist adds to the queue of its run's repository. */
export interface WorkerTaskRequest extends TaskFields {
  token: string;
}

/** `queue_edit`: the fields of an item to change. */
export interface QueueEditRequest extends Omit<ItemPatch, 'tags' | 'after'> {
  repository: string;
  item: string;
  tags?: string[] | undefined;
  parent?: string | number | null | undefined;
  after?: string[] | undefined;
}

/** `queue_settings`: the settings of a queue to change. */
export interface QueueSettingsRequest {
  repository: string;
  parallel?: number | undefined;
  autopilot?: boolean | undefined;
  autoAnswer?: boolean | undefined;
  skipFailed?: boolean | undefined;
  autopilotAnswer?: string | null | undefined;
  onLimit?: string | undefined;
  /** Pipeline ids and tag names; the service resolves them. */
  filter?: { pipelines?: string[] | undefined; tags?: string[] | undefined } | undefined;
}

/** A queue after a change, with the item the change concerns. */
export interface QueueChange {
  queue: Queue;
  item: string;
}

/** `run`: the item of the task, and its run when the queue took it at once. */
export interface Enqueued {
  item: string;
  number: number;
  run: RunCreated | null;
  queue: Queue;
}
