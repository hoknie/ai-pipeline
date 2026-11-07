import { useTranslation } from 'react-i18next';

import type {
  ConfigEditorResponse,
  EditorPipeline,
  FieldError,
  WriteLevel,
} from '../../../shared/api/types.ts';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { ValuesPicker } from '../../../shared/ui/forms/ValuesPicker.tsx';
import { SpecialistTagChip, sameTag } from '../../specialists/index.ts';

/** The tags of the pipeline: the shared ones as chips, its own ones as a picker. */
export function PipelineTagsInput({
  view,
  pipeline,
  level,
  tags,
  disabled,
  errors,
  onTags,
}: {
  view: ConfigEditorResponse;
  pipeline: EditorPipeline | null;
  level: WriteLevel;
  tags: string[];
  disabled: boolean;
  errors: FieldError[];
  onTags: (tags: string[]) => void;
}) {
  const { t } = useTranslation();
  // the shared tags of a pipeline are view only on the project level
  const shared = level === 'global' ? [] : (pipeline?.shared_tags ?? []);
  const suggestions = new Map<string, string>();
  for (const entry of view.pipelines) {
    for (const name of level === 'global' ? entry.shared_tags : entry.own_tags) {
      suggestions.set(name.toLocaleLowerCase(), name);
    }
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="pipeline-tags">
      <Label htmlFor="field-tags">{t('pipelines.tagsField')}</Label>
      {shared.length > 0 ? (
        <ul aria-label={t('pipelines.tagsSharedList')} className="flex flex-wrap gap-1.5">
          {shared.map((name) => (
            <li key={name}>
              <SpecialistTagChip name={name} shared hint={t('pipelines.tagsSharedHint')} />
            </li>
          ))}
        </ul>
      ) : null}
      <ValuesPicker
        id="field-tags"
        label={t('pipelines.tagsField')}
        values={tags}
        onChange={onTags}
        options={[...suggestions.values()]
          .filter((name) => !shared.some((known) => sameTag(known, name)))
          .map((name) => ({ name, source: 'project' as const }))}
        headings={{ project: t('pipelines.tagsOwn') }}
        disabled={disabled}
        invalid={errors.length > 0}
      />
      <p className="text-xs text-muted-foreground">{t('pipelines.tagsHelp')}</p>
      {errors.map((error) => (
        <p className="text-sm text-destructive" role="alert" key={error.message}>
          {error.message}
        </p>
      ))}
    </div>
  );
}
