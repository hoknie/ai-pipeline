import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../shared/lib/browser/cn.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { MarkdownField } from '../../../shared/ui/forms/MarkdownField.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../../shared/ui/forms/toggle-group.tsx';
import { TITLE_LIMIT, type QueueDraft } from '../draft.ts';

export type FormState = {
  idPrefix: string;
  effective: QueueDraft;
  change: (patch: Partial<QueueDraft>) => void;
  locked: boolean;
  /** A task for several projects: no groups. */
  several?: boolean;
};

function GroupsEditor({ idPrefix, effective, change, locked }: FormState) {
  const { t } = useTranslation();
  const setGroup = (index: number, patch: Partial<QueueDraft['groups'][number]>) =>
    change({
      groups: effective.groups.map((group, at) => (at === index ? { ...group, ...patch } : group)),
    });
  return (
    <div className="flex flex-col gap-2">
      {effective.groups.map((group, index) => (
        <fieldset key={index} className="flex flex-col gap-2 rounded-md border p-2">
          <legend className="px-1 text-xs text-muted-foreground">
            {t('queue.form.group', { n: index + 1 })}
          </legend>
          <Input
            id={`${idPrefix}-group-${index}-title`}
            disabled={locked}
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
            disabled={locked}
            onChange={(task) => setGroup(index, { task })}
          />
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            disabled={locked || effective.groups.length <= 1}
            onClick={() => change({ groups: effective.groups.filter((_, at) => at !== index) })}
          >
            {t('queue.form.removeGroup', { n: index + 1 })}
          </Button>
        </fieldset>
      ))}
      <p className="text-xs text-muted-foreground">{t('queue.form.groupAlternativeHint')}</p>
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={locked}
        onClick={() => change({ groups: [...effective.groups, { title: '', task: '' }] })}
      >
        {t('queue.form.addGroup')}
      </Button>
    </div>
  );
}

function KindSwitch({ state }: { state: FormState }) {
  const { t } = useTranslation();
  const { effective, change, locked } = state;
  return (
    <ToggleGroup
      type="single"
      aria-label={t('queue.form.kind')}
      className="w-fit"
      disabled={locked}
      value={effective.mode}
      onValueChange={(mode) => mode && change({ mode: mode as QueueDraft['mode'] })}
    >
      <ToggleGroupItem value="task">{t('queue.form.task')}</ToggleGroupItem>
      <ToggleGroupItem value="groups">{t('queue.form.groups')}</ToggleGroupItem>
    </ToggleGroup>
  );
}

/** The main column: repository, name, the kind of the task, and the text or the groups. */
export function TaskFields(props: {
  state: FormState;
  repositoryField?: ReactNode;
  /** Fields under the text of the task. */
  extras?: ReactNode;
  /** The text of the task grows with the column. */
  fill?: boolean;
}) {
  const { t } = useTranslation();
  const { state } = props;
  const { idPrefix, effective, change, locked } = state;
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', props.fill && 'flex-1')}>
      <fieldset disabled={locked} className="flex min-w-0 flex-col gap-3 border-0 p-0">
        {props.repositoryField ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-repository`}>{t('queue.form.repository')}</Label>
            {props.repositoryField}
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
      </fieldset>
      {state.several ? null : <KindSwitch state={state} />}
      {effective.mode === 'task' ? (
        <>
          <MarkdownField
            id={`${idPrefix}-task`}
            aria-label={t('queue.form.taskText')}
            rows={9}
            grow={props.fill}
            value={effective.task}
            placeholder={t('queue.form.taskPlaceholder')}
            disabled={locked}
            onChange={(task) => change({ task })}
          />
          <p className="text-xs text-muted-foreground">{t('queue.form.alternativeHint')}</p>
        </>
      ) : (
        <GroupsEditor {...state} />
      )}
      {props.extras}
    </div>
  );
}
