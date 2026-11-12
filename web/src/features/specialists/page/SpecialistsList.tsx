import { Download, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { EditorSpecialist, EntryLevel } from '../../../shared/api/types.ts';
import { specialistName } from '../../../shared/lib/catalog/specialists.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { EntryList } from '../../../shared/ui/layout/EntryList.tsx';
import { SpecialistTagChip } from '../SpecialistTagChip.tsx';
import { tagsOfSpecialist } from '../specialistTags.ts';

/** Key of the label of a level in the dictionaries, under `settings.editor.levels`. */
export const LEVEL_KEYS: Record<EntryLevel, EntryLevel> = {
  project: 'project',
  global: 'global',
  project_over_global: 'project_over_global',
};

function subtitleOf(entry: EditorSpecialist): string {
  const chain = (entry.raw.runtime_chain as string) ?? null;
  const runtime = chain
    ? `chain: ${chain}`
    : entry.effective
      ? `${entry.effective.runtime}${entry.effective.model ? ` · ${entry.effective.model}` : ''}`
      : null;
  return [entry.slug, runtime].filter(Boolean).join(' · ');
}

/** The new/import buttons, the filters, the hint for an empty result and the list itself. */
export function SpecialistsList({
  specialists,
  loaded,
  selected,
  narrowed,
  filtersControl,
  onNew,
  onImport,
  onReset,
  onSelect,
}: {
  specialists: EditorSpecialist[];
  loaded: boolean;
  selected: string | null;
  narrowed: boolean;
  filtersControl: ReactNode;
  onNew: () => void;
  onImport: () => void;
  onReset: () => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={onNew}>
          <Plus />
          {t('specialists.new')}
        </Button>
        <Button variant="outline" disabled={!loaded} onClick={onImport}>
          <Download />
          {t('specialists.import.open')}
        </Button>
      </div>
      {filtersControl}
      {loaded && specialists.length === 0 && narrowed ? (
        <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          <p>{t('specialists.filters.nothing')}</p>
          <Button variant="outline" size="sm" onClick={onReset}>
            {t('specialists.filters.reset')}
          </Button>
        </div>
      ) : null}
      <EntryList
        label={t('specialists.list')}
        selected={selected}
        onSelect={onSelect}
        entries={specialists.map((entry) => ({
          id: entry.slug,
          title: specialistName(entry),
          subtitle: subtitleOf(entry),
          tag: t(`settings.editor.levels.${LEVEL_KEYS[entry.level]}`),
          extra:
            tagsOfSpecialist(entry).length > 0 ? (
              <span data-testid={`tags-${entry.slug}`} className="flex flex-wrap gap-1">
                {tagsOfSpecialist(entry).map((tag) => (
                  <SpecialistTagChip key={tag.name} name={tag.name} shared={tag.shared} />
                ))}
              </span>
            ) : undefined,
        }))}
      />
    </>
  );
}
