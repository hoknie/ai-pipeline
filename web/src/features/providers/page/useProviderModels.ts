import { useCallback, useSyncExternalStore } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { AccessModels, ProviderModelsView } from '../../../shared/api/types.ts';
import { createShared } from './shared.ts';

const SEPARATOR = '\n';

const catalogs = createShared<ProviderModelsView>((api, key, refresh) =>
  api.providerModels(key.split(SEPARATOR)[1] ?? '', refresh),
);

/** Models of the access that applies: the effective one, else the first with a runtime. */
export function accessModelsOf(
  view: ProviderModelsView | null,
  active: number | null,
): AccessModels | null {
  if (!view) return null;
  return (
    view.access.find((item) => item.index === active) ??
    view.access.find((item) => item.runtime !== null) ??
    null
  );
}

/**
 * The model catalog of a provider, asked for when a combobox first opens (`ensure`) and shared by
 * the comboboxes of the page; `refresh` asks the CLIs again.
 */
export function useProviderModels(api: Api, repository: string | null, slug: string) {
  const key = `${repository ?? ''}${SEPARATOR}${slug}`;
  const subscribe = useCallback(
    (listener: () => void) => catalogs.subscribe(key, api, listener, false),
    [key, api],
  );
  const state = useSyncExternalStore(subscribe, () => catalogs.read(key));
  const ensure = useCallback(() => {
    if (catalogs.fetchedAt(key) === 0 && !catalogs.read(key).loading) void catalogs.reload(key);
  }, [key]);
  const refresh = useCallback(() => void catalogs.reload(key, true), [key]);
  return {
    view: state.value,
    error: state.failure,
    loading: state.loading,
    ensure,
    refresh,
  };
}
