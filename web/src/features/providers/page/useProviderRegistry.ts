import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, ProvidersView } from '../../../shared/api/types.ts';
import { createShared } from './shared.ts';

/** The registry is read again at most this often because of the events of the runs. */
export const REFRESH_MS = 5000;

const registries = createShared<ProvidersView>((api) => api.providers());
const editors = createShared<ConfigEditorResponse>((api) => api.config());

const keyOf = (repository: string | null) => repository ?? '';

/** Reads the registry of a project again, for every component that watches it. */
export function invalidateProviders(repository: string | null): Promise<void> {
  const key = keyOf(repository);
  return Promise.all([registries.reload(key, true), editors.reload(key, true)]).then(() => {});
}

/** Calls `read` again at most once per `REFRESH_MS` while `watch` changes. */
function useThrottledReload(key: string, watch: unknown): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const wait = registries.fetchedAt(key) + REFRESH_MS - Date.now();
    if (wait <= 0) {
      void registries.reload(key, true);
      return;
    }
    const timer = setTimeout(() => void registries.reload(key, true), wait);
    return () => clearTimeout(timer);
  }, [key, watch]);
}

/**
 * The roles and providers of a project with status and limit. Components of one project share one
 * request; it is repeated when the window gets focus, after a write (`invalidateProviders`) and
 * when `watch` (the runs) changes, at most every five seconds.
 */
export function useProviderRegistry(api: Api, repository: string | null, watch?: unknown) {
  const key = keyOf(repository);
  const subscribe = useCallback(
    (listener: () => void) => registries.subscribe(key, api, listener, true),
    [key, api],
  );
  const state = useSyncExternalStore(subscribe, () => registries.read(key));
  useEffect(() => {
    const onFocus = () => void registries.reload(key, true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [key]);
  useThrottledReload(key, watch);
  const reload = useCallback(() => registries.reload(key, true), [key]);
  return { view: state.value, failure: state.failure, loading: state.loading, reload };
}

/** The registries of several projects (the mode «All projects», a task for several projects). */
export function useProviderRegistries(
  api: Api,
  repositories: readonly string[],
  watch?: unknown,
): { views: (ProvidersView | null)[]; failures: string[] } {
  const joined = repositories.join('\n');
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = joined
        .split('\n')
        .filter((path) => path !== '')
        .map((path) => registries.subscribe(path, api.forRepository(path), listener, true));
      return () => stops.forEach((stop) => stop());
    },
    [joined, api],
  );
  const snapshot = useRef<{ key: string; value: ReturnType<typeof registries.read>[] }>({
    key: '',
    value: [],
  });
  const read = () => {
    const value = repositories.map((path) => registries.read(path));
    const same =
      snapshot.current.value.length === value.length &&
      snapshot.current.value.every((item, index) => item === value[index]);
    if (!same) snapshot.current = { key: joined, value };
    return snapshot.current.value;
  };
  const states = useSyncExternalStore(subscribe, read);
  useEffect(() => {
    if (watch === undefined) return;
    const timer = setTimeout(
      () => repositories.forEach((path) => void registries.reload(path, true)),
      REFRESH_MS,
    );
    return () => clearTimeout(timer);
  }, [joined, watch]);
  return {
    views: states.map((state) => state.value),
    failures: states.flatMap((state) => (state.failure ? [state.failure] : [])),
  };
}

/** The editor view of the configuration: the files and revisions behind the registry. */
export function useProviderEditor(api: Api, repository: string | null) {
  const key = keyOf(repository);
  const subscribe = useCallback(
    (listener: () => void) => editors.subscribe(key, api, listener, true),
    [key, api],
  );
  const state = useSyncExternalStore(subscribe, () => editors.read(key));
  return { editor: state.value, failure: state.failure };
}
