import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { Switch } from '../ui/switch.tsx';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../ui/select.tsx';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.tsx';

import type { Api } from '../api.ts';
import type { DeliveryMode } from '../../../src/config/index.ts';
import { DELIVERY_MODES } from '../deliveryModes.ts';
import { taskNumber } from '../format.ts';
import { useTags } from '../tags.tsx';
import type { QueueFields, WorkflowsView } from '../types.ts';
import { MarkdownField } from './MarkdownField.tsx';
import { SkipSteps, pruneSkip } from './SkipSteps.tsx';
import { TagPicker } from './TagPicker.tsx';
import type { AfterOption, ParentChoice } from './queueLinks.ts';
import { ValuesPicker, type PickerOption } from './ValuesPicker.tsx';

/** What the user has typed into a task form; kept outside the form so updates do not erase it. */
export interface QueueDraft {
  workflow: string;
  mode: 'task' | 'groups';
  task: string;
  groups: { title: string; task: string }[];
  title: string;
  /** `null`: follow the setting. */
  autoDeliver: boolean | null;
  /** `null`: follow the setting. */
  deliveryMode: DeliveryMode | null;
  /** Ids of the chosen tags. */
  tags: string[];
  /** Ids of the items and runs the task waits for, in the order of choice. */
  after: string[];
  /** Ids of the workflow steps the task skips. */
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

/** The value of the parent select that stands for no parent. */
const NO_PARENT = '__none__';

/** Picker group of each kind of predecessor. */
const SOURCE_OF = { current: 'builtin', item: 'project', run: 'global' } as const;

function stepsOf(workflow: { steps: { id: string; name?: string }[] } | undefined): {
  id: string;
  name: string;
}[] {
  return workflow?.steps.map((step) => ({ id: step.id, name: step.name ?? step.id })) ?? [];
}

export function emptyDraft(workflow = ''): QueueDraft {
  return {
    workflow,
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
  workflow: string;
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
    workflow: item.workflow,
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
 * workflow stays when the new repository has it and is replaced by the first one otherwise.
 * The tags are cleared (every repository has its own catalog); the text, the name and the
 * delivery settings are kept.
 */
export function retarget(
  draft: QueueDraft,
  workflowIds: readonly string[],
  stepIdsOf: (workflow: string) => string[],
): QueueDraft {
  const workflow = workflowIds.includes(draft.workflow)
    ? draft.workflow
    : (workflowIds[0] ?? draft.workflow);
  return {
    ...draft,
    workflow,
    after: [],
    afterTouched: false,
    parent: null,
    parentTouched: false,
    skip: pruneSkip(draft.skip, stepIdsOf(workflow)),
    tags: [],
  };
}

export function draftValid(draft: QueueDraft): boolean {
  if (draft.workflow === '') return false;
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
    workflow: draft.workflow,
    ...(draft.mode === 'task'
      ? { task: draft.task.trim() }
      : {
          groups: draft.groups.map((group) => ({
            title: group.title.trim(),
            task: group.task.trim(),
          })),
        }),
    ...(title !== '' ? { title } : {}),
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

export function QueueForm({
  idPrefix,
  draft,
  workflows,
  repository,
  api,
  autoDeliverDefault = null,
  deliveryModeDefault = null,
  afterChoices = [],
  parentChoices = [],
  locked = false,
  repositoryField,
  pending = false,
  submitLabel,
  onDraft,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  draft: QueueDraft;
  workflows: WorkflowsView | null;
  /** The repository of the task; its tag catalog is the one the tag field offers. */
  repository: string | null;
  /** Lets the tag field create tags; without it the field only picks. */
  api?: Api;
  /** `delivery.auto` of the repository now; null when it is not known. */
  autoDeliverDefault?: boolean | null;
  /** `delivery.mode` of the repository now; null when it is not known. */
  deliveryModeDefault?: DeliveryMode | null;
  /** What the task can wait for. */
  afterChoices?: AfterOption[];
  /** The runs the task can be a child of, in the order to show them. */
  parentChoices?: ParentChoice[];
  /** A returned run keeps its own task: only the predecessors can change. */
  locked?: boolean;
  /** The field of the repository, the first in the left half; only a new task has it. */
  repositoryField?: ReactNode;
  /** The data of the form is still loading: the form cannot be sent. */
  pending?: boolean;
  submitLabel: string;
  onDraft: (draft: QueueDraft) => void;
  /** Rejects with the message to show next to the form; the draft is kept then. */
  onSubmit: (fields: QueueFields) => Promise<void>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const catalog = useTags();
  const ids = workflows?.workflows.map((workflow) => workflow.id) ?? [];
  // a draft started before the workflows were known takes the first one
  const effective: QueueDraft =
    draft.workflow === '' && ids[0] ? { ...draft, workflow: ids[0] } : draft;
  const change = (patch: Partial<QueueDraft>) => onDraft({ ...effective, ...patch });
  const setGroup = (index: number, patch: Partial<QueueDraft['groups'][number]>) =>
    change({
      groups: effective.groups.map((group, at) => (at === index ? { ...group, ...patch } : group)),
    });
  const valid = draftValid(effective);

  const submit = async () => {
    if (!valid || busy || pending) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(
        fieldsOf(
          effective,
          (id) => {
            const tag = catalog.byId.get(id);
            return tag && tag.repository === repository && !tag.task ? tag.name : undefined;
          },
          idPrefix !== 'new',
        ),
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const afterTitle = new Map(afterChoices.map((choice) => [choice.id, choice.title]));
  const afterPick: PickerOption[] = afterChoices.map((choice) => ({
    name: choice.id,
    source: SOURCE_OF[choice.kind],
    description:
      choice.number === null ? choice.title : `${taskNumber(choice.number)} ${choice.title}`,
  }));
  let outside: { id: string; number: number | null; title: string } | null = null;
  if (
    effective.parent !== null &&
    !parentChoices.some((choice) => choice.id === effective.parent)
  ) {
    const linked = catalog.of(repository).find((tag) => tag.task?.run === effective.parent);
    outside = {
      id: effective.parent,
      number: linked?.task?.number ?? null,
      title: linked?.name ?? effective.parent,
    };
  }
  const parentLabel = (choice: { number: number | null; title: string }) =>
    choice.number === null ? choice.title : `${taskNumber(choice.number)} ${choice.title}`;
  const parentSections = (['active', 'planned', 'finished'] as const).map((section) => ({
    section,
    label: t(
      section === 'active'
        ? 'queue.form.parentActive'
        : section === 'planned'
          ? 'queue.form.parentPlanned'
          : 'queue.form.parentFinished',
    ),
    choices: parentChoices.filter((choice) => choice.section === section),
  }));
  const options = [...ids];
  if (effective.workflow !== '' && !ids.includes(effective.workflow))
    options.push(effective.workflow);
  return (
    <form
      className="@container flex flex-col gap-3 rounded-lg border bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-4 @3xl:grid-cols-2">
        <fieldset disabled={locked} className="flex min-w-0 flex-col gap-3 border-0 p-0">
          {repositoryField !== undefined ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-repository`}>{t('queue.form.repository')}</Label>
              {repositoryField}
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-title`}>{t('queue.form.name')}</Label>
            <Input
              id={`${idPrefix}-title`}
              value={effective.title}
              maxLength={TITLE_LIMIT}
              placeholder={t('queue.form.namePlaceholder')}
              onChange={(event) => change({ title: event.target.value })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={`${idPrefix}-workflow`}>{t('queue.form.workflow')}</Label>
            <Select
              value={effective.workflow}
              onValueChange={(workflow) =>
                change({
                  workflow,
                  skip: pruneSkip(
                    effective.skip,
                    stepsOf(
                      workflows?.workflows.find((candidate) => candidate.id === workflow),
                    ).map((step) => step.id),
                  ),
                })
              }
              disabled={options.length === 0}
            >
              <SelectTrigger id={`${idPrefix}-workflow`} className="w-48">
                <SelectValue placeholder={t('queue.form.noWorkflow')} />
              </SelectTrigger>
              <SelectContent>
                {options.map((id) => (
                  <SelectItem key={id} value={id}>
                    {workflows?.workflows.find((candidate) => candidate.id === id)?.name ?? id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ToggleGroup
              type="single"
              aria-label={t('queue.form.kind')}
              value={effective.mode}
              onValueChange={(mode) => mode && change({ mode: mode as QueueDraft['mode'] })}
            >
              <ToggleGroupItem value="task">{t('queue.form.task')}</ToggleGroupItem>
              <ToggleGroupItem value="groups">{t('queue.form.groups')}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {effective.mode === 'task' ? (
            <MarkdownField
              id={`${idPrefix}-task`}
              aria-label={t('queue.form.taskText')}
              rows={9}
              value={effective.task}
              placeholder={t('queue.form.taskPlaceholder')}
              onChange={(task) => change({ task })}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {effective.groups.map((group, index) => (
                <fieldset key={index} className="flex flex-col gap-2 rounded-md border p-2">
                  <legend className="px-1 text-xs text-muted-foreground">
                    {t('queue.form.group', { n: index + 1 })}
                  </legend>
                  <Input
                    id={`${idPrefix}-group-${index}-title`}
                    aria-label={t('queue.form.groupTitle', { n: index + 1 })}
                    value={group.title}
                    placeholder={t('queue.form.titlePlaceholder')}
                    onChange={(event) => setGroup(index, { title: event.target.value })}
                  />
                  <MarkdownField
                    aria-label={t('queue.form.groupText', { n: index + 1 })}
                    rows={2}
                    value={group.task}
                    placeholder={t('queue.form.groupTaskPlaceholder')}
                    onChange={(task) => setGroup(index, { task })}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit"
                    disabled={effective.groups.length <= 1}
                    onClick={() =>
                      change({ groups: effective.groups.filter((_, at) => at !== index) })
                    }
                  >
                    {t('queue.form.removeGroup', { n: index + 1 })}
                  </Button>
                </fieldset>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => change({ groups: [...effective.groups, { title: '', task: '' }] })}
              >
                {t('queue.form.addGroup')}
              </Button>
            </div>
          )}
        </fieldset>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-after`}>{t('queue.form.after')}</Label>
            <ValuesPicker
              id={`${idPrefix}-after`}
              label={t('queue.form.after')}
              values={effective.after}
              onChange={(after) => change({ after, afterTouched: true })}
              options={afterPick}
              display={(id) => afterTitle.get(id) || id}
              headings={{
                builtin: t('queue.form.afterCurrent'),
                project: t('queue.form.afterItems'),
                global: t('queue.form.afterRuns'),
              }}
              creatable={false}
              contentClassName="min-w-80"
            />
          </div>
          <fieldset disabled={locked} className="flex min-w-0 flex-col gap-1.5 border-0 p-0">
            <Label htmlFor={`${idPrefix}-parent`}>{t('queue.form.parent')}</Label>
            <Select
              value={effective.parent ?? NO_PARENT}
              onValueChange={(value) =>
                change({ parent: value === NO_PARENT ? null : value, parentTouched: true })
              }
            >
              <SelectTrigger id={`${idPrefix}-parent`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>{t('queue.form.noParent')}</SelectItem>
                {outside ? (
                  <SelectItem value={outside.id}>{parentLabel(outside)}</SelectItem>
                ) : null}
                {parentSections.map(({ section, label, choices }) =>
                  choices.length > 0 ? (
                    <SelectGroup key={section}>
                      <SelectLabel>{label}</SelectLabel>
                      {choices.map((choice) => (
                        <SelectItem key={choice.id} value={choice.id}>
                          {parentLabel(choice)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null,
                )}
              </SelectContent>
            </Select>
          </fieldset>
          <fieldset disabled={locked} className="flex min-w-0 flex-col gap-1.5 border-0 p-0">
            <Label htmlFor={`${idPrefix}-tags`}>{t('queue.form.tags')}</Label>
            <TagPicker
              id={`${idPrefix}-tags`}
              label={t('queue.form.tags')}
              selected={effective.tags}
              onChange={(tags) => change({ tags })}
              repository={repository}
              api={api}
              allowCreate={api !== undefined}
              hideLinked
            />
          </fieldset>
          <fieldset disabled={locked} className="contents">
            <div className="flex flex-wrap items-center gap-2">
              <Switch
                id={`${idPrefix}-auto-deliver`}
                checked={effective.autoDeliver ?? autoDeliverDefault ?? true}
                onCheckedChange={(autoDeliver) => change({ autoDeliver })}
              />
              <Label htmlFor={`${idPrefix}-auto-deliver`}>{t('queue.form.autoDeliver')}</Label>
              <span className="text-xs text-muted-foreground">
                {effective.autoDeliver === null
                  ? t('queue.form.autoDeliverBySetting')
                  : t('queue.form.autoDeliverForTask')}
              </span>
              {effective.autoDeliver !== null ? (
                <Button variant="ghost" size="sm" onClick={() => change({ autoDeliver: null })}>
                  {t('queue.form.autoDeliverReset')}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={`${idPrefix}-delivery-mode`}>{t('queue.form.deliveryMode')}</Label>
              <Select
                value={effective.deliveryMode ?? deliveryModeDefault ?? 'worktree'}
                onValueChange={(deliveryMode) =>
                  change({ deliveryMode: deliveryMode as DeliveryMode })
                }
              >
                <SelectTrigger id={`${idPrefix}-delivery-mode`} className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERY_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {t(`deliveryMode.${mode}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {effective.deliveryMode === null
                  ? t('queue.form.deliveryModeBySetting')
                  : t('queue.form.deliveryModeForTask')}
              </span>
              {effective.deliveryMode !== null ? (
                <Button variant="ghost" size="sm" onClick={() => change({ deliveryMode: null })}>
                  {t('queue.form.deliveryModeReset')}
                </Button>
              ) : null}
            </div>
            <SkipSteps
              idPrefix={idPrefix}
              steps={stepsOf(
                workflows?.workflows.find((candidate) => candidate.id === effective.workflow),
              )}
              skip={effective.skip}
              onChange={(skip) => change({ skip })}
            />
          </fieldset>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!valid || busy || pending}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            {t('queue.form.cancel')}
          </Button>
        ) : null}
      </div>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </form>
  );
}
