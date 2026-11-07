import { useEffect, useMemo } from 'react';

import type { EditorSpecialist } from '../../../shared/api/types.ts';
import { usePreference } from '../../../shared/lib/browser/preferences.ts';
import {
  EMPTY_FILTER,
  LIST_FIELDS,
  existingFilter,
  filterOptions,
  type SpecialistFilter,
} from '../specialistFilters.ts';

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Only well-formed parts of a saved choice are used. */
function savedOthers(saved: unknown): Partial<Omit<SpecialistFilter, 'tags'>> {
  if (typeof saved !== 'object' || saved === null) return {};
  const record = saved as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const field of LIST_FIELDS) if (isStrings(record[field])) result[field] = record[field];
  if (record.level === 'all' || record.level === 'project' || record.level === 'global') {
    result.level = record.level;
  }
  return result;
}

/** The filter of the list, kept per repository; a value nobody has any more drops out. */
export function useSpecialistFilter(
  specialists: readonly EditorSpecialist[],
  repository: string | null,
  loaded: boolean,
) {
  // the chosen tags are kept per repository
  const [chosenByRepository, setChosenByRepository] = usePreference<Record<string, string[]>>(
    'specialistTags',
    {},
  );
  // the other filters are kept per repository too
  const [othersByRepository, setOthersByRepository] = usePreference<
    Record<string, Partial<Omit<SpecialistFilter, 'tags'>>>
  >('specialistFilters', {});
  const options = useMemo(() => filterOptions(specialists), [specialists]);
  const stored = useMemo<SpecialistFilter>(
    () =>
      repository === null
        ? EMPTY_FILTER
        : {
            ...EMPTY_FILTER,
            ...savedOthers(othersByRepository[repository]),
            tags: chosenByRepository[repository] ?? [],
          },
    [chosenByRepository, othersByRepository, repository],
  );
  const filter = useMemo(() => existingFilter(stored, options), [stored, options]);
  const save = (next: SpecialistFilter) => {
    if (repository === null) return;
    const { tags, ...others } = next;
    setChosenByRepository({ ...chosenByRepository, [repository]: tags });
    setOthersByRepository({ ...othersByRepository, [repository]: others });
  };
  useEffect(() => {
    if (loaded && JSON.stringify(filter) !== JSON.stringify(stored)) save(filter);
    // `save` only writes the preferences the dependencies below stand for
  }, [loaded, repository, filter, stored, chosenByRepository, othersByRepository]);
  return { filter, setFilter: save, options };
}
