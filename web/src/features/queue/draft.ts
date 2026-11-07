import type { DeliveryMode } from '../../../../src/feature/swarm-config/types/index.ts';
import type { QueueFields } from '../../shared/api/types.ts';
import { pruneSkip } from './SkipSteps.tsx';

/** What the user has typed into a task form; kept outside the form so updates do not erase it. */
export interface QueueDraft {
  pipeline: string;
  mode: 'task' | 'groups';
  task: string;
  groups: { title: string; task: string }[];
  title: string;
  /** Add the task postponed; only the new-task form sets it. */
  postponed?: boolean;
  /** `null`: follow the setting. */
  autoDeliver: boolean | null;
  /** `null`: follow the setting. */
  deliveryMode: DeliveryMode | null;
  /** Ids of the chosen tags. */
  tags: string[];
  /** Ids of the items and runs the task waits for, in the order of choice. */
  after: string[];
  /** Ids of the pipeline steps the task skips. */
  skip: string[];
  /** The user changed the field: an edit sends `after` only then. */
  afterTouched: boolean;
  /** Id of the run whose linked task tag the task gets; `null`: none. */
  parent: string | null;
  /** The user changed the parent: an edit sends `parent` only then. */
  parentTouched: boolean;
  /** The repository the draft was typed for; not sent, the repository goes in the address. */
  repository?: string | null;
}

export const TITLE_LIMIT = 60;

export function stepsOf(pipeline: { steps: { id: string; name?: string }[] } | undefined): {
  id: string;
  name: string;
}[] {
  return pipeline?.steps.map((step) => ({ id: step.id, name: step.name ?? step.id })) ?? [];
}

export function emptyDraft(pipeline = ''): QueueDraft {
  return {
    pipeline,
    mode: 'task',
    task: '',
    groups: [{ title: '', task: '' }],
    title: '',
    autoDeliver: null,
    deliveryMode: null,
    tags: [],
    after: [],
    skip: [],
    afterTouched: false,
    parent: null,
    parentTouched: false,
  };
}

/** The draft of an existing item, for editing. */
export function draftOf(item: {
  pipeline: string;
  task: string | null;
  groups: { title: string; task: string }[] | null;
  title: string | null;
  autoDeliver: boolean | null;
  deliveryMode?: DeliveryMode | null;
  tags?: { id: string; task?: { run: string } | null }[];
  after?: { id: string }[];
  skip?: string[];
}): QueueDraft {
  return {
    pipeline: item.pipeline,
    mode: item.groups ? 'groups' : 'task',
    task: item.task ?? '',
    groups: item.groups ? item.groups.map((group) => ({ ...group })) : [{ title: '', task: '' }],
    title: item.title ?? '',
    autoDeliver: item.autoDeliver,
    deliveryMode: item.deliveryMode ?? null,
    tags: (item.tags ?? []).map((tag) => tag.id),
    after: (item.after ?? []).map((ref) => ref.id),
    skip: [...(item.skip ?? [])],
    afterTouched: false,
    parent: (item.tags ?? []).find((tag) => tag.task)?.task?.run ?? null,
    parentTouched: false,
  };
}

/**
 * The draft moved to another repository: the links to its items and runs are cleared, the
 * pipeline stays when the new repository has it and is replaced by the first one otherwise.
 * The tags are cleared (every repository has its own catalog); the text, the name and the
 * delivery settings are kept.
 */
export function retarget(
  draft: QueueDraft,
  pipelineIds: readonly string[],
  stepIdsOf: (pipeline: string) => string[],
): QueueDraft {
  const pipeline = pipelineIds.includes(draft.pipeline)
    ? draft.pipeline
    : (pipelineIds[0] ?? draft.pipeline);
  return {
    ...draft,
    pipeline,
    after: [],
    afterTouched: false,
    parent: null,
    parentTouched: false,
    skip: pruneSkip(draft.skip, stepIdsOf(pipeline)),
    tags: [],
  };
}

export function draftValid(draft: QueueDraft): boolean {
  if (draft.pipeline === '') return false;
  if ([...draft.title.trim()].length > TITLE_LIMIT) return false;
  if (draft.mode === 'task') return draft.task.trim() !== '';
  return (
    draft.groups.length > 0 &&
    draft.groups.every((group) => group.title.trim() !== '' && group.task.trim() !== '')
  );
}

/**
 * The fields to send. Tags go by name; an id that is no longer in the catalog is dropped. With
 * `allTags` the list is always sent (an edit replaces the tags), otherwise only when not empty.
 */
export function fieldsOf(
  draft: QueueDraft,
  tagName: (id: string) => string | undefined = () => undefined,
  allTags = false,
): QueueFields {
  const title = draft.title.trim();
  const tags = draft.tags.flatMap((id) => tagName(id) ?? []);
  return {
    pipeline: draft.pipeline,
    ...(draft.mode === 'task'
      ? { task: draft.task.trim() }
      : {
          groups: draft.groups.map((group) => ({
            title: group.title.trim(),
            task: group.task.trim(),
          })),
        }),
    ...(title !== '' ? { title } : {}),
    ...(draft.postponed ? { postponed: true } : {}),
    ...(draft.autoDeliver !== null ? { autoDeliver: draft.autoDeliver } : {}),
    ...(draft.deliveryMode !== null ? { deliveryMode: draft.deliveryMode } : {}),
    ...(allTags || tags.length > 0 ? { tags } : {}),
    ...(allTags || draft.skip.length > 0 ? { skip: draft.skip } : {}),
    ...(allTags
      ? draft.afterTouched
        ? { after: draft.after }
        : {}
      : draft.after.length > 0
        ? { after: draft.after }
        : {}),
    ...(allTags
      ? draft.parentTouched
        ? { parent: draft.parent }
        : {}
      : draft.parent !== null
        ? { parent: draft.parent }
        : {}),
  };
}
