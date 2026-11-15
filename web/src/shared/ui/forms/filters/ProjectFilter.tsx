import { useTranslation } from 'react-i18next';

import type { ProjectOption } from '../../../lib/catalog/projectRows.ts';
import { FilterField } from './FilterField.tsx';

/** The multiselect «Project» of a list that merges projects: the shared entries and each project. */
export function ProjectFilter({
  options,
  selected,
  counts,
  onChange,
}: {
  options: ProjectOption[];
  selected: string[];
  /** How many rows each choice shows. */
  counts?: ReadonlyMap<string, number> | undefined;
  onChange: (values: string[]) => void;
}) {
  const { t } = useTranslation();
  if (options.length === 0) return null;
  return (
    <FilterField
      label={t('specialists.filters.project')}
      selected={selected}
      onChange={onChange}
      options={options.map((option) => ({
        value: option.value,
        label: option.label ?? t('specialists.filters.sharedProject'),
        count: counts?.get(option.value) ?? 0,
      }))}
      clearLabel={t('runs.list.clear')}
    />
  );
}
