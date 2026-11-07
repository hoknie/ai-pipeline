import {
  findPipeline,
  type DeliveryMode,
  type ResolvedConfig,
} from '../feature/swarm-config/types/index.ts';

import { groupSlugs, runName } from './ids.ts';
import { applySkip } from './skip.ts';
import { SPLIT_GROUP, emptyRepair, newGroup, type RunState } from './model.ts';
import { enterPoint } from './stages.ts';

export interface NewGroup {
  title: string;
  task: string;
}

export interface NewRun {
  id: string;
  repository: string;
  pipeline: string;
  baseCommit: string;
  config: ResolvedConfig;
  dirtyWarning: boolean;
  groups: NewGroup[];
  split: boolean;
  now: number;
  /** Title given by the user; the name is then derived from it. */
  title?: string;
  /** The run is created by a task queue. */
  fromQueue?: boolean;
  /** Id of the queue item the run starts from. */
  queueItem?: string | null;
  /** Number of the task the run is created for. */
  number: number;
  /** Overrides `delivery.auto` of the configuration for this run only. */
  autoDeliver?: boolean | undefined;
  /** Overrides `delivery.mode` of the configuration for this run only. */
  deliveryMode?: DeliveryMode | undefined;
  /** Ids of catalog tags. */
  tags?: string[] | undefined;
  /** Ids of pipeline steps this run skips. */
  skip?: string[] | undefined;
}

export function createRun(input: NewRun): RunState {
  const pipeline = findPipeline(input.config, input.pipeline);
  if (!pipeline) {
    const known = input.config.pipelines.map((pipeline) => pipeline.id).join(', ');
    throw new Error(`unknown pipeline \`${input.pipeline}\`; known: ${known || 'none'}`);
  }
  if (input.groups.length === 0) throw new Error('a run needs at least one group');
  for (const group of input.groups) {
    if (group.task.trim() === '') throw new Error(`group \`${group.title}\` has an empty task`);
  }
  const skipped = applySkip(input.config, input.pipeline, input.skip ?? []);
  const config =
    input.autoDeliver === undefined && input.deliveryMode === undefined
      ? skipped
      : {
          ...skipped,
          delivery: {
            ...skipped.delivery,
            ...(input.autoDeliver !== undefined ? { auto: input.autoDeliver } : {}),
            ...(input.deliveryMode !== undefined ? { mode: input.deliveryMode } : {}),
          },
        };
  const splitting = input.split && pipeline.split !== null && input.groups.length === 1;
  const slugs = groupSlugs(input.groups.map((group) => group.title));
  const task = input.groups[0]?.task ?? '';
  const state: RunState = {
    run: {
      id: input.id,
      repository: input.repository,
      pipeline: input.pipeline,
      baseCommit: input.baseCommit,
      branch: `refs/aip/${input.id}/run`,
      refStyle: 'refs',
      createdAt: input.now,
      finishedAt: null,
      config,
      dirtyWarning: input.dirtyWarning,
      nextMergeSeq: 0,
      pendingDelivery: null,
      title: input.title?.trim() || null,
      name: input.title?.trim() ? runName(input.title) : null,
      namingUsage: null,
      fromQueue: input.fromQueue ?? false,
      queueItem: input.queueItem ?? null,
      number: input.number,
      tags: [...(input.tags ?? [])],
      skippedSteps: [],
      hold: null,
      repair: emptyRepair(),
    },
    split: splitting ? newGroup(SPLIT_GROUP, 'split', task, -1) : null,
    groups: splitting
      ? []
      : input.groups.map((group, index) =>
          newGroup(slugs[index] ?? `group-${index + 1}`, group.title, group.task, index),
        ),
    message: null,
    resolve: null,
    repair: null,
    actions: [],
  };
  // The actions before the split exist from the start; the split waits for them.
  if (state.split) enterPoint(state, 'before_split');
  return state;
}

export function groupsFromTask(task: string): NewGroup[] {
  const firstLine = task.trim().split('\n')[0] ?? '';
  return [{ title: firstLine.slice(0, 80) || 'task', task }];
}
