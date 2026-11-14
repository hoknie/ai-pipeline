import type { DeliveryMode } from '../../../../src/feature/swarm-config/types/index.ts';
import type { AttachmentView, QueueFields } from '../../shared/api/types.ts';
import { pruneSkip } from '../../shared/ui/forms/picker/SkipSteps.tsx';

/** A file picked for the task: being sent to the panel, sent (`upload`) or refused (`error`). */
export interface AttachmentEntry {
  key: string;
  fileName: string;
  size: number;
  /** Share sent, 0 to 100. */
  progress: number;
  /** Id the panel gave the file; the task is sent with it. */
  upload: string | null;
  error: string | null;
}

/** What the user has typed into a task form; kept outside the form so updates do not erase it. */
export interface QueueDraft {
  pipeline: string;
  /** Id of the chosen variant of the pipeline; `default` is the pipeline as it is. */
  variant: string;
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
  /** The files picked for the task; they are sent to the panel at once. */
  attachments?: AttachmentEntry[];
  /** The attachments the edited item already has. */
  existing?: AttachmentView[];
  /** Names of the existing attachments to remove. */
  detached?: string[];
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
    variant: 'default',
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

/** The draft for the next task after "add and continue": name, text, groups and links are cleared. */
export function continueDraft(draft: QueueDraft): QueueDraft {
  return {
    ...draft,
    task: '',
    groups: [{ title: '', task: '' }],
    title: '',
    after: [],
    afterTouched: false,
  };
}

/** The draft of an existing item, for editing. */
export function draftOf(item: {
  pipeline: string;
  variant?: string;
  task: string | null;
  groups: { title: string; task: string }[] | null;
  title: string | null;
  autoDeliver: boolean | null;
  deliveryMode?: DeliveryMode | null;
  tags?: { id: string; task?: { run: string } | null }[];
  after?: { id: string }[];
  skip?: string[];
  attachments?: AttachmentView[];
}): QueueDraft {
  return {
    pipeline: item.pipeline,
    variant: item.variant ?? 'default',
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
    ...(item.attachments && item.attachments.length > 0
      ? { existing: item.attachments.map((file) => ({ ...file })) }
      : {}),
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
  variantIdsOf: (pipeline: string) => string[] = () => [],
): QueueDraft {
  const pipeline = pipelineIds.includes(draft.pipeline)
    ? draft.pipeline
    : (pipelineIds[0] ?? draft.pipeline);
  const variants = variantIdsOf(pipeline);
  return {
    ...draft,
    pipeline,
    variant: variants.includes(draft.variant) ? draft.variant : 'default',
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
  if (uploading(draft)) return false;
  if ([...draft.title.trim()].length > TITLE_LIMIT) return false;
  if (draft.mode === 'task') return draft.task.trim() !== '' || draft.title.trim() !== '';
  return (
    draft.groups.length > 0 &&
    draft.groups.every((group) => group.title.trim() !== '' || group.task.trim() !== '')
  );
}

function groupTitleFromTask(task: string): string {
  const firstLine =
    task
      .split(/\r\n|\r|\n/)
      .find((line) => line.trim() !== '')
      ?.trim() ?? '';
  return Array.from(firstLine).slice(0, TITLE_LIMIT).join('');
}

/** Files picked and sent to the panel; the entries still on their way or refused are left out. */
export function uploadsOf(draft: QueueDraft): string[] {
  return (draft.attachments ?? []).flatMap((entry) => (entry.upload === null ? [] : entry.upload));
}

/** A file is still being sent: the form cannot be submitted yet. */
export function uploading(draft: QueueDraft): boolean {
  return (draft.attachments ?? []).some((entry) => entry.upload === null && entry.error === null);
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
  const uploads = uploadsOf(draft);
  const detach = draft.detached ?? [];
  return {
    pipeline: draft.pipeline,
    ...(allTags || draft.variant !== 'default' ? { variant: draft.variant } : {}),
    ...(draft.mode === 'task'
      ? { task: draft.task.trim() || title }
      : {
          groups: draft.groups.map((group) => ({
            title: group.title.trim() || groupTitleFromTask(group.task),
            task: group.task.trim() || group.title.trim(),
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
    ...(uploads.length > 0 ? { uploads } : {}),
    ...(detach.length > 0 ? { detach } : {}),
    ...(allTags
      ? draft.parentTouched
        ? { parent: draft.parent }
        : {}
      : draft.parent !== null
        ? { parent: draft.parent }
        : {}),
  };
}
