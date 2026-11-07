import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  ConfigEditorResponse,
  EditorSpecialist,
  WriteLevel,
} from '../../../shared/api/types.ts';
import { ValuesPicker } from '../../../shared/ui/forms/ValuesPicker.tsx';
import { sameTag } from '../specialistTags.ts';
import { SpecialistTagChip } from '../SpecialistTagChip.tsx';
import type { Draft } from './draft.ts';

/** The tags of the specialist: the shared ones as chips, its own ones as a picker. */
export function SpecialistTagsInput({
  view,
  specialist,
  level,
  draft,
  setDraft,
  disabled,
  invalid,
}: {
  view: ConfigEditorResponse;
  specialist: EditorSpecialist | null;
  level: WriteLevel;
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  disabled: boolean;
  invalid: boolean;
}) {
  const { t } = useTranslation();
  // on the shared level the tags are the shared ones: view only
  const shared = level === 'global' ? draft.tags : (specialist?.shared_tags ?? []);
  const suggestions = new Map<string, string>();
  for (const entry of view.specialists) {
    for (const name of entry.own_tags) suggestions.set(name.toLocaleLowerCase(), name);
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="specialist-tags">
      {shared.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <ul aria-label={t('specialists.tags.sharedList')} className="flex flex-wrap gap-1.5">
            {shared.map((name) => (
              <li key={name}>
                <SpecialistTagChip name={name} shared />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {level === 'global' ? null : (
        <ValuesPicker
          id="field-tags"
          label={t('specialists.fields.tags')}
          values={draft.tags}
          onChange={(items) => setDraft((current) => ({ ...current, tags: items }))}
          options={[...suggestions.values()]
            .filter((name) => !shared.some((known) => sameTag(known, name)))
            .map((name) => ({ name, source: 'project' as const }))}
          headings={{ project: t('specialists.tags.own') }}
          disabled={disabled}
          invalid={invalid}
        />
      )}
    </div>
  );
}
