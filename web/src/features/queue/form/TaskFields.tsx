import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { MarkdownField } from '../../../shared/ui/forms/MarkdownField.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui/forms/select.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../../shared/ui/forms/toggle-group.tsx';
import type { PipelinesView } from '../../../shared/api/types.ts';
import { TITLE_LIMIT, stepsOf, type QueueDraft } from '../draft.ts';
import { pruneSkip } from '../../../shared/ui/forms/picker/SkipSteps.tsx';

export type FormState = {
  idPrefix: string;
  effective: QueueDraft;
  change: (patch: Partial<QueueDraft>) => void;
  locked: boolean;
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

function PipelineSelect({
  state,
  pipelines,
  options,
}: {
  state: FormState;
  pipelines: PipelinesView | null;
  options: string[];
}) {
  const { t } = useTranslation();
  const { idPrefix, effective, change } = state;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={`${idPrefix}-pipeline`}>{t('queue.form.pipeline')}</Label>
      <Select
        value={effective.pipeline}
        onValueChange={(pipeline) =>
          change({
            pipeline,
            variant: 'default',
            skip: pruneSkip(
              effective.skip,
              stepsOf(pipelines?.pipelines.find((candidate) => candidate.id === pipeline)).map(
                (step) => step.id,
              ),
            ),
          })
        }
        disabled={options.length === 0}
      >
        <SelectTrigger id={`${idPrefix}-pipeline`} className="w-48">
          <SelectValue placeholder={t('queue.form.noPipeline')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((id) => (
            <SelectItem key={id} value={id}>
              {pipelines?.pipelines.find((candidate) => candidate.id === id)?.name ?? id}
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
  );
}

function VariantSelect({
  state,
  pipelines,
}: {
  state: FormState;
  pipelines: PipelinesView | null;
}) {
  const { t } = useTranslation();
  const { idPrefix, effective, change } = state;
  const variants =
    pipelines?.pipelines.find((candidate) => candidate.id === effective.pipeline)?.variants ?? [];
  // A pipeline with only `default` has nothing to choose.
  if (variants.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={`${idPrefix}-variant`}>{t('queue.form.variant')}</Label>
      <Select value={effective.variant} onValueChange={(variant) => change({ variant })}>
        <SelectTrigger id={`${idPrefix}-variant`} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {variants.map((variant) => (
            <SelectItem key={variant.id} value={variant.id}>
              {variant.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The left half of the form: repository, name, pipeline, and the text or the groups. */
export function TaskFields(props: {
  state: FormState;
  pipelines: PipelinesView | null;
  options: string[];
  repositoryField: ReactNode;
}) {
  const { t } = useTranslation();
  const { state } = props;
  const { idPrefix, effective, change, locked } = state;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <fieldset disabled={locked} className="flex min-w-0 flex-col gap-3 border-0 p-0">
        {props.repositoryField !== undefined ? (
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
        <PipelineSelect state={state} pipelines={props.pipelines} options={props.options} />
        <VariantSelect state={state} pipelines={props.pipelines} />
      </fieldset>
      {effective.mode === 'task' ? (
        <>
          <p className="text-xs text-muted-foreground">{t('queue.form.alternativeHint')}</p>
          <MarkdownField
            id={`${idPrefix}-task`}
            aria-label={t('queue.form.taskText')}
            rows={9}
            value={effective.task}
            placeholder={t('queue.form.taskPlaceholder')}
            disabled={locked}
            onChange={(task) => change({ task })}
          />
        </>
      ) : (
        <GroupsEditor {...state} />
      )}
    </div>
  );
}
