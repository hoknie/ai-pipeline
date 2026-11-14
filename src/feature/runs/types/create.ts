import { invalid, rejected } from '../../../platform/errors/index.ts';
import { RUN_NAME_LIMIT } from '../../agents/types/index.ts';
import {
  type DeliveryMode,
  DEFAULT_VARIANT,
  type ResolvedConfig,
  applyVariant,
  checkVariant,
  findPipeline,
  isValidSlug,
  variantSkip,
} from '../../swarm-config/types/index.ts';
import { SPLIT_GROUP } from './constants.ts';
import { newGroup } from './group.ts';
import { type RunAttachment, type RunState, emptyRepair } from './run.ts';
import { applySkip } from './skip.ts';
import { enterPoint } from './stage-status.ts';

export interface NewGroup {
  title: string;
  task: string;
}

/** The task a run is created from: what a queue item stands for. */
export interface RunRequest {
  repository: string;
  pipeline: string;
  task?: string | undefined;
  groups?: NewGroup[] | undefined;
  title?: string | undefined;
  autoDeliver?: boolean | undefined;
  deliveryMode?: DeliveryMode | undefined;
  skip?: string[] | undefined;
  /** Id of a variant of the pipeline; absent: `default`. */
  variant?: string | undefined;
  /** The files attached to the task. */
  attachments?: RunAttachment[] | undefined;
}

/** A run the queue has just created. */
export interface RunCreated {
  runId: string;
  /** Number of the task of the run. */
  number: number;
  branch: string;
  groups: { slug: string; title: string }[];
  split: boolean;
  warnings: string[];
}

/** What a run says about itself right after it was created or taken from the queue again. */
export function runCreated(state: RunState, warnings: string[] = []): RunCreated {
  return {
    runId: state.run.id,
    number: state.run.number,
    branch: state.run.branch,
    groups: state.groups.map((group) => ({ slug: group.slug, title: group.title })),
    split: state.split !== null,
    warnings,
  };
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
  /** Id of a variant of the pipeline; absent: `default`. */
  variant?: string | undefined;
  /** Files attached to the task. */
  attachments?: RunAttachment[] | undefined;
}

export function createRun(input: NewRun): RunState {
  const pipeline = findPipeline(input.config, input.pipeline);
  if (!pipeline) {
    const known = input.config.pipelines.map((pipeline) => pipeline.id).join(', ');
    throw invalid(
      'core.invalid_run',
      `unknown pipeline \`${input.pipeline}\`; known: ${known || 'none'}`,
    );
  }
  if (input.groups.length === 0)
    throw invalid('core.invalid_run', 'a run needs at least one group');
  for (const group of input.groups) {
    if (group.task.trim() === '')
      throw invalid('core.invalid_run', `group \`${group.title}\` has an empty task`);
  }
  const variant = input.variant ?? DEFAULT_VARIANT;
  const variantError = checkVariant(input.config, input.pipeline, variant);
  if (variantError !== null) throw rejected(variantError);
  const skipped = applySkip(applyVariant(input.config, input.pipeline, variant), input.pipeline, [
    ...variantSkip(input.config, input.pipeline, variant),
    ...(input.skip ?? []),
  ]);
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
      variant,
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
      attachments: (input.attachments ?? []).map((attachment) => ({ ...attachment })),
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

function base36(value: number, width: number): string {
  return Math.floor(value).toString(36).padStart(width, '0').slice(-width);
}

export const RUN_ID_LENGTH = 12;

export function runId(nowMillis: number, random: number): string {
  return base36(nowMillis, 8) + base36(random % 36 ** 4, 4);
}

const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

export function slugify(title: string): string {
  let output = '';
  for (const character of title.toLowerCase()) {
    if (/[a-z0-9]/.test(character)) output += character;
    else if (character in CYRILLIC) output += CYRILLIC[character];
    else if (!output.endsWith('-')) output += '-';
  }
  let slug = output.replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(slug)) slug = `g-${slug}`;
  slug = slug.slice(0, 32).replace(/-+$/, '');
  return isValidSlug(slug) ? slug : 'group';
}

export function groupSlugs(titles: string[]): string[] {
  const slugs: string[] = [];
  for (const title of titles) {
    const base = slugify(title);
    let candidate = base;
    for (let counter = 2; slugs.includes(candidate); counter += 1) {
      const suffix = `-${counter}`;
      candidate = base.slice(0, 32 - suffix.length).replace(/-+$/, '') + suffix;
    }
    slugs.push(candidate);
  }
  return slugs;
}

/** English-like kebab-case name of a run, transliterated from its title. */
export function runName(title: string): string {
  let output = '';
  for (const character of title.toLowerCase()) {
    if (/[a-z0-9]/.test(character)) output += character;
    else if (character in CYRILLIC) output += CYRILLIC[character];
    else if (!output.endsWith('-')) output += '-';
  }
  const name = output
    .replace(/^-+|-+$/g, '')
    .slice(0, RUN_NAME_LIMIT)
    .replace(/-+$/, '');
  return name || 'run';
}
