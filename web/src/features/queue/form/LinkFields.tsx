import { useTranslation } from 'react-i18next';
import { Label } from '../../../shared/ui/forms/label.tsx';
import type { Api } from '../../../shared/api/api.ts';
import { TagPicker } from '../../tags/index.ts';
import type { FormState } from './TaskFields.tsx';

/** Keep an existing pipeline in the list even when it is no longer in the catalog. */
export function withCurrent(ids: string[], pipeline: string): string[] {
  return pipeline !== '' && !ids.includes(pipeline) ? [...ids, pipeline] : ids;
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
