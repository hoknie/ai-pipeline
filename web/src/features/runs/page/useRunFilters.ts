import { useState } from 'react';

import { usePreference } from '../../../shared/lib/browser/preferences.ts';
import { useTags } from '../../../shared/lib/catalog/tags.tsx';
import { EMPTY_FILTERS, type RunFilterState } from '../list/runFilter.ts';

/** The tags chosen before the filters were stored together, so that the choice survives. */
function legacyTags(): string[] {
  try {
    const raw = window.localStorage.getItem('aip.web.runTags');
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** The stored filters of the list and the state of their column; stale tags drop out. */
export function useRunFilters(repository: string | null) {
  const { byId } = useTags();
  const [legacy] = useState(legacyTags);
  const [stored, setStored] = usePreference<RunFilterState>('runFilters', {
    ...EMPTY_FILTERS,
    tagIds: legacy,
  });
  const [collapsed, setCollapsed] = usePreference<boolean>('runFiltersCollapsed', false);
  // an id that is not in the catalog of the selected repository (the tag was removed, or the
  // repository changed) drops out of the selection
  const filters: RunFilterState = {
    ...EMPTY_FILTERS,
    ...stored,
    tagIds: (stored.tagIds ?? []).filter((id) => byId.get(id)?.repository === repository),
  };
  return { filters, setStored, collapsed, setCollapsed, byId };
}
