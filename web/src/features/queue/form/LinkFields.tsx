import { useTranslation } from 'react-i18next';

import { Label } from '../../../shared/ui/forms/label.tsx';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui/forms/select.tsx';
import { ValuesPicker, type PickerOption } from '../../../shared/ui/forms/ValuesPicker.tsx';
import type { Api } from '../../../shared/api/api.ts';
import { TagPicker } from '../../tags/index.ts';
import { taskNumber } from '../../../shared/lib/format.ts';
import { useTags } from '../../../shared/lib/catalog/tags.tsx';
import type { AfterOption, ParentChoice } from '../queueLinks.ts';
import type { FormState } from './TaskFields.tsx';

/** The value of the parent select that stands for no parent. */
const NO_PARENT = '__none__';

/** Picker group of each kind of predecessor. */
const SOURCE_OF = { current: 'builtin', item: 'project', run: 'global' } as const;

const labelOf = (choice: { number: number | null; title: string }) =>
  choice.number === null ? choice.title : `${taskNumber(choice.number)} ${choice.title}`;

/** What the task waits for: items of the queue and runs. */
export function AfterField({ state, choices }: { state: FormState; choices: AfterOption[] }) {
  const { t } = useTranslation();
  const { idPrefix, effective, change } = state;
  const titles = new Map(choices.map((choice) => [choice.id, labelOf(choice)]));
  const options: PickerOption[] = choices.map((choice) => ({
    name: choice.id,
    source: SOURCE_OF[choice.kind],
    description: labelOf(choice),
  }));
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`${idPrefix}-after`}>{t('queue.form.after')}</Label>
      <ValuesPicker
        id={`${idPrefix}-after`}
        label={t('queue.form.after')}
        values={effective.after}
        onChange={(after) => change({ after, afterTouched: true })}
        options={options}
        display={(id) => titles.get(id) || id}
        headings={{
          builtin: t('queue.form.afterCurrent'),
          project: t('queue.form.afterItems'),
          global: t('queue.form.afterRuns'),
        }}
        creatable={false}
        contentClassName="min-w-80"
      />
    </div>
  );
}

/** The run the task is a child of; a parent outside the list is kept as its own option. */
export function ParentField({
  state,
  choices,
  repository,
}: {
  state: FormState;
  choices: ParentChoice[];
  repository: string | null;
}) {
  const { t } = useTranslation();
  const catalog = useTags();
  const { idPrefix, effective, change, locked } = state;
  let outside: { id: string; number: number | null; title: string } | null = null;
  if (effective.parent !== null && !choices.some((choice) => choice.id === effective.parent)) {
    const linked = catalog.of(repository).find((tag) => tag.task?.run === effective.parent);
    outside = {
      id: effective.parent,
      number: linked?.task?.number ?? null,
      title: linked?.name ?? effective.parent,
    };
  }
  const sections = (['active', 'planned', 'finished'] as const).map((section) => ({
    section,
    label: t(
      section === 'active'
        ? 'queue.form.parentActive'
        : section === 'planned'
          ? 'queue.form.parentPlanned'
          : 'queue.form.parentFinished',
    ),
    choices: choices.filter((choice) => choice.section === section),
  }));
  return (
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
          {outside ? <SelectItem value={outside.id}>{labelOf(outside)}</SelectItem> : null}
          {sections.map(({ section, label, choices: group }) =>
            group.length > 0 ? (
              <SelectGroup key={section}>
                <SelectLabel>{label}</SelectLabel>
                {group.map((choice) => (
                  <SelectItem key={choice.id} value={choice.id}>
                    {labelOf(choice)}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null,
          )}
        </SelectContent>
      </Select>
    </fieldset>
  );
}

/** The tags of the task, from the catalog of its repository. */
export function TagsField({
  state,
  repository,
  api,
}: {
  state: FormState;
  repository: string | null;
  api: Api | undefined;
}) {
  const { t } = useTranslation();
  const { idPrefix, effective, change, locked } = state;
  return (
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
  );
}
