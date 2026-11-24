import type { AttachmentSource } from '../../attachments/types/index.ts';
import type { NewGroup, RunCreated } from '../../runs/types/index.ts';
import type { DeliveryMode } from '../../swarm-config/types/index.ts';

import type { ItemPatch } from './edit.ts';
import type { Queue } from './items.ts';
import type { LinkInput } from './links.ts';

/** The task of a queue item as a client or a specialist describes it. */
export interface TaskFields {
  pipeline: string;
  /** Id of a variant of the pipeline; absent: `default`. */
  variant?: string | undefined;
  /** Id of a known provider the task runs on; absent or `null`: not chosen. */
  provider?: string | null | undefined;
  task?: string | undefined;
  groups?: NewGroup[] | undefined;
  title?: string | undefined;
  autoDeliver?: boolean | undefined;
  deliveryMode?: DeliveryMode | undefined;
  skip?: string[] | undefined;
  /** Ids of queue items or runs this task waits for. */
  after?: string[] | undefined;
  /** `false`: the task takes no tags of its predecessors, now and later; default: it takes them. */
  inheritTags?: boolean | undefined;
  /** Links of the task: `{kind, target}`; not together with `after` or `parent`. */
  links?: LinkInput[] | undefined;
}

/** `run` and `queue_add`: a task for the queue of a repository. */
export interface QueueAddRequest extends TaskFields {
  repository: string;
  /** Tag names of the catalog. */
  tags?: string[] | undefined;
  /** The run (id or task number) whose linked task tag the new task carries. */
  parent?: string | number | undefined;
  postponed?: boolean | undefined;
  /** Id of the user adding the task (from the actor of the call). */
  author?: string | null | undefined;
  /** The call is by `system`: the task has no author and is marked so. */
  createdBySystem?: boolean | undefined;
  /** Files to attach: absolute paths; a specialist's task has none. */
  attachments?: AttachmentSource[] | undefined;
  /** Adds the task even when the same one already waits in the queue. */
  allowDuplicate?: boolean | undefined;
}

/** `queue_add_projects`: one task for the queues of several repositories. */
export interface QueueAddProjectsRequest extends TaskFields {
  /** Paths or slugs, in the order of the chain. */
  repositories: string[];
  task: string;
  postponed?: boolean | undefined;
  author?: string | null | undefined;
  /** The call is by `system`: the task has no author and is marked so. */
  createdBySystem?: boolean | undefined;
  /** An addition to the task text per project, by path or slug. */
  notes?: Record<string, string> | undefined;
  /** The name of the tag every item gets from the catalog of its project; empty: none. */
  tag?: string | undefined;
  /** Each task waits for the one of the previous project. */
  chain?: boolean | undefined;
  /** Adds the task even where the same one already waits in the queue. */
  allowDuplicate?: boolean | undefined;
}

/** One item of `queue_add_projects`. */
export interface AddedToProject {
  repository: string;
  /** The slug of the project. */
  project: string;
  item: string;
  number: number;
}

/** `worker_queue_add`: a task a specialist adds to the queue of its run's repository. */
export interface WorkerTaskRequest extends TaskFields {
  token: string;
}

/** `worker_queue_edit`: the fields of a waiting task of its run a specialist changes. */
export interface WorkerTaskEditRequest extends Omit<
  ItemPatch,
  'tags' | 'after' | 'position' | 'postponed' | 'inheritTags'
> {
  token: string;
  item: string;
  after?: string[] | undefined;
  /** Replaces the links of the task except its parent, which stays the run. */
  links?: LinkInput[] | undefined;
}

/** `worker_queue_remove`: a waiting task of its run a specialist removes. */
export interface WorkerTaskRemoveRequest {
  token: string;
  item: string;
}

/** `queue_edit`: the fields of an item to change. */
export interface QueueEditRequest extends Omit<ItemPatch, 'tags' | 'after'> {
  repository: string;
  item: string;
  tags?: string[] | undefined;
  parent?: string | number | null | undefined;
  after?: string[] | undefined;
  /** Replaces every link of the item; not together with `after` or `parent`. */
  links?: LinkInput[] | undefined;
  /** Files to attach to an item that waits in the queue. */
  attach?: AttachmentSource[] | undefined;
  /** Names of attachments to remove. */
  detach?: string[] | undefined;
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
  filter?:
    | {
        pipelines?: string[] | undefined;
        tags?: string[] | undefined;
        /** Projects of the global queue: paths or slugs. */
        projects?: string[] | undefined;
      }
    | undefined;
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
