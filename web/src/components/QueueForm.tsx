import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { takeFocusRequest } from '../hotkeys.ts';
import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { Switch } from '../ui/switch.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.tsx';
import { Textarea } from '../ui/textarea.tsx';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.tsx';

import type { Api } from '../api.ts';
import { useTags } from '../tags.tsx';
import type { QueueFields, WorkflowsView } from '../types.ts';
import { TagPicker } from './TagPicker.tsx';
import type { AfterOption } from './queueLinks.ts';
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
  /** Ids of the chosen tags. */
  tags: string[];
  /** Ids of the items and runs the task waits for, in the order of choice. */
  after: string[];
  /** The user changed the field: an edit sends `after` only then. */
  afterTouched: boolean;
}

export const TITLE_LIMIT = 60;

export function emptyDraft(workflow = ''): QueueDraft {
  return {
    workflow,
    mode: 'task',
    task: '',
    groups: [{ title: '', task: '' }],
    title: '',
    autoDeliver: null,
    tags: [],
    after: [],
    afterTouched: false,
  };
}

/** The draft of an existing item, for editing. */
export function draftOf(item: {
  workflow: string;
  task: string | null;
  groups: { title: string; task: string }[] | null;
  title: string | null;
  autoDeliver: boolean | null;
  tags?: { id: string }[];
  after?: { id: string }[];
}): QueueDraft {
  return {
    workflow: item.workflow,
    mode: item.groups ? 'groups' : 'task',
    task: item.task ?? '',
    groups: item.groups ? item.groups.map((group) => ({ ...group })) : [{ title: '', task: '' }],
    title: item.title ?? '',
    autoDeliver: item.autoDeliver,
    tags: (item.tags ?? []).map((tag) => tag.id),
    after: (item.after ?? []).map((ref) => ref.id),
    afterTouched: false,
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
    ...(allTags || tags.length > 0 ? { tags } : {}),
    ...(allTags
      ? draft.afterTouched
        ? { after: draft.after }
        : {}
      : draft.after.length > 0
        ? { after: draft.after }
        : {}),
  };
}

export function QueueForm({
  idPrefix,
  draft,
  workflows,
  api,
  autoDeliverDefault = null,
  afterChoices = [],
  submitLabel,
  onDraft,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  draft: QueueDraft;
  workflows: WorkflowsView | null;
  /** Lets the tag field create tags; without it the field only picks. */
  api?: Api;
  /** `delivery.auto` of the repository now; null when it is not known. */
  autoDeliverDefault?: boolean | null;
  /** What the task can wait for. */
  afterChoices?: AfterOption[];
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
  const taskField = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () =>
      idPrefix === 'new'
        ? takeFocusRequest('queue-task', () => taskField.current?.focus())
        : undefined,
    [idPrefix],
  );
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
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(fieldsOf(effective, (id) => catalog.byId.get(id)?.name, idPrefix !== 'new'));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const afterTitle = new Map(afterChoices.map((choice) => [choice.id, choice.title]));
  const afterPick: PickerOption[] = afterChoices.map((choice) => ({
    name: choice.id,
    source: choice.kind === 'run' ? 'builtin' : 'project',
    description: choice.title,
  }));
  const options = [...ids];
  if (effective.workflow !== '' && !ids.includes(effective.workflow))
    options.push(effective.workflow);
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`${idPrefix}-workflow`}>Workflow</Label>
        <Select
          value={effective.workflow === '' ? undefined : effective.workflow}
          onValueChange={(workflow) => change({ workflow })}
          disabled={options.length === 0}
        >
          <SelectTrigger id={`${idPrefix}-workflow`} className="w-48">
            <SelectValue placeholder={t('queue.form.noWorkflow')} />
          </SelectTrigger>
          <SelectContent>
            {options.map((id) => (
              <SelectItem key={id} value={id}>
                {id}
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
        <Textarea
          ref={taskField}
          aria-label={t('queue.form.taskText')}
          rows={3}
          value={effective.task}
          placeholder={t('queue.form.taskPlaceholder')}
          onChange={(event) => change({ task: event.target.value })}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {effective.groups.map((group, index) => (
            <fieldset key={index} className="flex flex-col gap-2 rounded-md border p-2">
              <legend className="px-1 text-xs text-muted-foreground">
                {t('queue.form.group', { n: index + 1 })}
              </legend>
              <Input
                aria-label={t('queue.form.groupTitle', { n: index + 1 })}
                value={group.title}
                placeholder={t('queue.form.titlePlaceholder')}
                onChange={(event) => setGroup(index, { title: event.target.value })}
              />
              <Textarea
                aria-label={t('queue.form.groupText', { n: index + 1 })}
                rows={2}
                value={group.task}
                placeholder={t('queue.form.groupTaskPlaceholder')}
                onChange={(event) => setGroup(index, { task: event.target.value })}
              />
              <Button
                variant="ghost"
                size="sm"
                className="w-fit"
                disabled={effective.groups.length <= 1}
                onClick={() => change({ groups: effective.groups.filter((_, at) => at !== index) })}
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
        <Label htmlFor={`${idPrefix}-tags`}>{t('queue.form.tags')}</Label>
        <div className="min-w-0 max-w-xl">
          <TagPicker
            id={`${idPrefix}-tags`}
            label={t('queue.form.tags')}
            selected={effective.tags}
            onChange={(tags) => change({ tags })}
            api={api}
            allowCreate={api !== undefined}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`${idPrefix}-after`}>{t('queue.form.after')}</Label>
        <div className="min-w-0 max-w-xl">
          <ValuesPicker
            id={`${idPrefix}-after`}
            label={t('queue.form.after')}
            values={effective.after}
            onChange={(after) => change({ after, afterTouched: true })}
            options={afterPick}
            display={(id) => afterTitle.get(id) || id}
            headings={{ project: t('queue.form.afterItems'), builtin: t('queue.form.afterRuns') }}
            creatable={false}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t('queue.form.name')}
          className="max-w-xs flex-1"
          value={effective.title}
          maxLength={TITLE_LIMIT}
          placeholder={t('queue.form.namePlaceholder')}
          onChange={(event) => change({ title: event.target.value })}
        />
        <Button type="submit" disabled={!valid || busy}>
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
