import {
  type Queue,
  type QueueItem,
  DEFAULT_AUTOPILOT_ANSWER,
  canReturn,
  freezeCandidate,
  itemReadiness,
  lookupIn,
  matchesFilter,
  type ItemLookup,
  occupiesSlot,
} from '../../../feature/queue/types/index.ts';
import { stepProgress, summarize } from '../../../feature/runs/services/index.ts';
import {
  type Group,
  type GroupWait,
  type RunAttachment,
  type RunState,
  allGroups,
  attemptStepLabel,
  isRunFinished,
  isTerminal,
  runProblems,
  runTitle,
  stepLabel,
  stepsOf,
} from '../../../feature/runs/types/index.ts';
import {
  type DeliveryMode,
  pipelineNameOf,
  providerName,
  variantNameOf,
} from '../../../feature/swarm-config/types/index.ts';
import type { Tag } from '../../../feature/tags/types/index.ts';
import type { QueueItemView, QueueRunView, QueueView } from '../contract/responses/queue.ts';
import type { WaitLookup } from '../contract/responses/runs.ts';
import { itemRunMarks } from './cleanup/index.ts';
import {
  NO_WAITS,
  dependencyView,
  displayStatus,
  groupHold,
  groupLimitUntil,
  itemCard,
  serviceStatus,
  systemGroups,
} from './rows.ts';
import { deliveryStage } from './runs.ts';
import { tagViews } from './tags.ts';

/** Card of a run of the queue; `stopping`: the problem shown is the one that stops a queue. */
function queueRunView(
  queue: Queue,
  state: RunState,
  catalog: readonly Tag[],
  stopping: boolean,
  waits: WaitLookup,
): QueueRunView {
  const waitOf = (group: Group): GroupWait | null =>
    group.status === 'queued' ? waits(state.run.id, group.slug) : null;
  const problems = runProblems(state);
  const problem =
    (stopping ? problems.find((p) => p.reason !== 'needs_human') : undefined) ?? problems[0];
  return {
    id: state.run.id,
    returnable: canReturn(queue, state),
    priority: queue.priority.includes(state.run.id),
    number: state.run.number,
    title: runTitle(state),
    state: summarize(state).state,
    pipeline: state.run.pipeline,
    pipelineName: pipelineNameOf(state.run.config, state.run.pipeline),
    variant: state.run.variant,
    variantName: variantNameOf(state.run.config, state.run.pipeline, state.run.variant),
    provider: state.run.provider,
    providerName:
      state.run.provider === null ? null : providerName(state.run.config, state.run.provider),
    tags: tagViews(catalog, state.run.tags),
    createdAt: state.run.createdAt,
    groups: {
      done: state.groups.filter((group) => isTerminal(group.status)).length,
      total: state.groups.length,
    },
    steps: stepProgress(state),
    // A settled observer step (failed, cancelled) of a run that still works is not the state of
    // the run: the card shows what the run does, not the observer's old failure.
    system: systemGroups(state)
      .filter(
        ({ kind, group }) => kind !== 'repair' || !isTerminal(group.status) || isRunFinished(state),
      )
      .map(({ kind, group }) => ({
        kind,
        status: displayStatus(serviceStatus(group), waitOf(group), groupHold(state, group)),
        ...(kind === 'action' ? { title: group.title } : {}),
      })),
    delivery: deliveryStage(state)?.status ?? null,
    waiting: allGroups(state).flatMap((group) => {
      const wait = waitOf(group);
      if (wait === null) return [];
      const index = group.pending?.stepIndex;
      const steps = stepsOf(state.run, group);
      const found = index === undefined ? undefined : steps[index];
      return [
        {
          group: group.slug,
          step: found?.id ?? null,
          stepName: found ? stepLabel(state.run.config, steps, found) : null,
          wait,
        },
      ];
    }),
    active: allGroups(state)
      .filter((group) => group.status === 'running' || group.status === 'merging')
      .map((group) => {
        const last = group.attempts.at(-1);
        return {
          group: group.slug,
          step: last?.stepId ?? null,
          stepName: last ? attemptStepLabel(state, group, last) : null,
        };
      }),
    delivering: isRunFinished(state) && occupiesSlot(state),
    usage: summarize(state).usage,
    problem: problem ? { group: problem.group, reason: problem.reason } : null,
    limitUntil: allGroups(state).reduce<number | null>((latest, group) => {
      const until = groupLimitUntil(group);
      return until === null ? latest : Math.max(latest ?? 0, until);
    }, null),
  };
}

/** The stop of a queue; a usage limit of a provider also names the provider by the run's configuration. */
function stopView(
  stop: Queue['stop'],
  lookup: (id: string) => RunState | undefined,
): QueueView['stop'] {
  if (stop === null || stop.kind !== 'limit' || stop.provider === undefined) return stop;
  const config = lookup(stop.run)?.run.config;
  const name = config === undefined ? null : providerName(config, stop.provider);
  return name === null ? stop : { ...stop, providerName: name };
}

/** Card of one waiting task of the queue. */
function itemView(
  queue: Queue,
  item: QueueItem,
  index: number,
  context: {
    lookup: (id: string) => RunState | undefined;
    names: (id: string) => string;
    variantNames: (pipeline: string, variant: string) => string;
    providerNames: (slug: string) => string | null;
    find: ItemLookup;
    catalog: readonly Tag[];
    attachments: (item: string) => RunAttachment[];
    links: (ids: string[]) => Pick<QueueItemView, 'links' | 'linkedBy'>;
  },
): QueueItemView {
  const { lookup, names, variantNames, providerNames, find, catalog, attachments, links } = context;
  return {
    id: item.id,
    number: item.number,
    position: index + 1,
    // the snapshots fill the author in: the views do not read the accounts
    author: null,
    createdBySystem: item.createdBySystem,
    ...itemCard(item, lookup, names, variantNames, providerNames),
    title: item.title,
    autoDeliver: item.autoDeliver,
    deliveryMode: item.deliveryMode,
    deliveryBranch: item.deliveryBranch ?? null,
    tags: tagViews(catalog, item.tags),
    inheritTags: item.inheritTags,
    skip: [...(item.run === null ? item.skip : (lookup(item.run)?.run.skippedSteps ?? []))],
    readiness: itemReadiness(find, item, lookup),
    after: item.after.map((ref) => dependencyView(find, ref, lookup)),
    ...links(item.run === null ? [item.id] : [item.id, item.run]),
    postponed: item.postponed,
    filtered: !matchesFilter(queue.filter, item),
    createdAt: item.createdAt,
    error: item.error,
    run: item.run,
    ...itemRunMarks(item, lookup),
    attachments:
      item.run === null
        ? attachments(item.id)
        : (lookup(item.run)?.run.attachments ?? []).map((file) => ({ ...file })),
  };
}

export function queueView(
  queue: Queue,
  lookup: (id: string) => RunState | undefined,
  autoDeliver: boolean | null = null,
  catalog: readonly Tag[] = [],
  deliveryMode: DeliveryMode | null = null,
  waits: WaitLookup = NO_WAITS,
  names: (id: string) => string = (id) => id,
  variantNames: (pipeline: string, variant: string) => string = (_pipeline, variant) => variant,
  attachments: (item: string) => RunAttachment[] = () => [],
  find: ItemLookup = lookupIn(queue),
  links: (ids: string[]) => Pick<QueueItemView, 'links' | 'linkedBy'> = () => ({
    links: [],
    linkedBy: [],
  }),
  providerNames: (slug: string) => string | null = () => null,
): QueueView {
  const cards = (ids: string[], stopping: boolean): QueueRunView[] =>
    ids.flatMap((id) => {
      const state = lookup(id);
      return state ? [queueRunView(queue, state, catalog, stopping, waits)] : [];
    });
  const runs = cards(queue.runs, false);
  const skipped = cards(queue.skipped, true);
  const context = {
    lookup,
    names,
    variantNames,
    providerNames,
    find,
    catalog,
    attachments,
    links,
  };
  return {
    scope: 'project',
    repository: queue.repository,
    status: queue.status,
    parallel: queue.parallel,
    autopilot: queue.autopilot,
    autoAnswer: queue.autoAnswer,
    skipFailed: queue.skipFailed,
    autoDeliver,
    deliveryMode,
    autopilotAnswer: queue.autopilotAnswer,
    autopilotAnswerDefault: DEFAULT_AUTOPILOT_ANSWER,
    onLimit: queue.onLimit,
    filter: { pipelines: [...queue.filter.pipelines], tags: [...queue.filter.tags] },
    filterTags: tagViews(catalog, queue.filter.tags),
    stop: stopView(queue.stop, lookup),
    freezeCandidate:
      queue.runs.length >= queue.parallel
        ? freezeCandidate(
            queue,
            queue.runs.flatMap((id) => lookup(id) ?? []),
            null,
          )
        : null,
    items: queue.items.map((item, index) => itemView(queue, item, index, context)),
    runs,
    skipped,
    updatedAt: queue.updatedAt,
  };
}
