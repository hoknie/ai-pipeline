import type { OnLimit } from '../../../runs/types/index.ts';
import type { QueueScopeName } from '../../../swarm-config/types/index.ts';
import type { Queue, QueueStop } from '../items.ts';
import { tagNamed, type Tag } from '../../../tags/types/index.ts';

/** The key of the global queue where the key of a project queue (its path) would stand. */
export const GLOBAL_KEY = 'global';

/** What the global queue takes; an empty list means any. */
export interface GlobalFilter {
  /** Ids of pipelines. */
  pipelines: string[];
  /** Paths of projects. */
  projects: string[];
  /** Tag names, shared across project-specific catalogs. */
  tags: string[];
}

/**
 * The one queue of the `global` mode: its settings and its state. The tasks stay in the queues of
 * their projects; `global_position` of each item says where it stands among all of them.
 */
export interface GlobalQueue {
  status: 'stopped' | 'running';
  parallel: number;
  autopilot: boolean;
  autoAnswer: boolean;
  skipFailed: boolean;
  autopilotAnswer: string | null;
  onLimit: OnLimit;
  filter: GlobalFilter;
  /** Runs created by the queue that still occupy a place. */
  runs: string[];
  priority: string[];
  acknowledged: string[];
  skipped: string[];
  stop: QueueStop | null;
  /** The mode the stored queues were last arranged for. */
  appliedScope: QueueScopeName;
  updatedAt: number;
}

export function emptyGlobalQueue(now: number): GlobalQueue {
  return {
    status: 'stopped',
    parallel: 1,
    autopilot: false,
    autoAnswer: false,
    skipFailed: false,
    autopilotAnswer: null,
    onLimit: 'wait',
    filter: { pipelines: [], projects: [], tags: [] },
    runs: [],
    priority: [],
    acknowledged: [],
    skipped: [],
    stop: null,
    appliedScope: 'project',
    updatedAt: now,
  };
}

/** Whether a running global queue takes the tasks of the project. */
export function takesProject(filter: GlobalFilter, repository: string): boolean {
  return filter.projects.length === 0 || filter.projects.includes(repository);
}

/** Whether an item's project-specific tag ids match every selected name. */
export function takesTags(
  filter: GlobalFilter,
  ids: readonly string[],
  catalog: readonly Tag[],
): boolean {
  return (
    filter.tags.length === 0 ||
    filter.tags.every((name) => {
      const tag = tagNamed(catalog, name);
      return tag !== undefined && ids.includes(tag.id);
    })
  );
}

/** The fields the movement and the settings of a queue share, copied between a queue and a line. */
const SHARED = [
  'status',
  'parallel',
  'autopilot',
  'autoAnswer',
  'skipFailed',
  'autopilotAnswer',
  'onLimit',
  'runs',
  'priority',
  'acknowledged',
  'skipped',
  'stop',
  'updatedAt',
] as const;

/** A `Queue` standing for the global queue and the given items, so the one set of rules moves it. */
export function lineOf(global: GlobalQueue, items: Queue['items']): Queue {
  return {
    repository: GLOBAL_KEY,
    status: global.status,
    parallel: global.parallel,
    autopilot: global.autopilot,
    autoAnswer: global.autoAnswer,
    skipFailed: global.skipFailed,
    autopilotAnswer: global.autopilotAnswer,
    onLimit: global.onLimit,
    filter: { pipelines: [...global.filter.pipelines], tags: [] },
    items,
    nextNumber: 1,
    runs: [...global.runs],
    priority: [...global.priority],
    acknowledged: [...global.acknowledged],
    skipped: [...global.skipped],
    stop: global.stop,
    updatedAt: global.updatedAt,
  };
}

/** Takes the state a line was moved to back into the global queue. */
export function absorbLine(global: GlobalQueue, line: Queue): void {
  for (const key of SHARED) Object.assign(global, { [key]: line[key] });
  global.filter = { ...global.filter, pipelines: [...line.filter.pipelines] };
}
