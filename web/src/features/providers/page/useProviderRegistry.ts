import { useCallback, useRef, useSyncExternalStore } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import { liveTopics } from '../../../shared/api/live/topics.ts';
import type { ConfigEditorResponse, ProvidersView } from '../../../shared/api/types.ts';
import { createShared } from './shared.ts';

/** The level a registry is read at: both levels merged for a project, or the shared one alone. */
export type RegistryLevel = 'global' | undefined;

const GLOBAL_MARK = '\u0000global';

const registries = createShared<ProvidersView>((api, key) =>
  api.providers(key.endsWith(GLOBAL_MARK) ? 'global' : undefined),
);
const editors = createShared<ConfigEditorResponse>((api) => api.config());

const keyOf = (repository: string | null) => repository ?? '';
const registryKey = (repository: string | null, level?: RegistryLevel) =>
  level === 'global' ? `${keyOf(repository)}${GLOBAL_MARK}` : keyOf(repository);

/** Reads the registry of a project again, for every component that watches it; both levels. */
export function invalidateProviders(repository: string | null): Promise<void> {
  const key = keyOf(repository);
  return Promise.all([
    registries.reload(key, true),
    registries.reload(registryKey(repository, 'global'), true),
    editors.reload(key, true),
  ]).then(() => {});
}

/** The subscriptions to the registries: one per key for all the components that watch it. */
const watched = new Map<string, { count: number; stop: () => void }>();

/**
 * Watches the registry of a key for one more component: the server sends it when it changes, and
 * a return of the focus to the window asks for it again.
 */
function watchRegistry(key: string, api: Api, listener: () => void): () => void {
  const leave = registries.subscribe(key, api, listener, false);
  let entry = watched.get(key);
  if (!entry) {
    registries.expect(key);
    const repository = api.repository ?? undefined;
    const watch = liveTopics.watch(
      api,
      {
        kind: 'providers',
        ...(repository === undefined ? {} : { repository }),
        ...(key.endsWith(GLOBAL_MARK) ? { level: 'global' as const } : {}),
      },
      (value) => registries.receive(key, { value }),
      (failure) => registries.receive(key, { failure }),
    );
    const onFocus = () => watch.refresh();
    window.addEventListener('focus', onFocus);
    entry = {
      count: 0,
      stop: () => {
        window.removeEventListener('focus', onFocus);
        watch();
      },
    };
    watched.set(key, entry);
  }
  entry.count += 1;
  const mine = entry;
  return () => {
    mine.count -= 1;
    if (mine.count === 0) {
      mine.stop();
      watched.delete(key);
    }
    leave();
  };
}

/**
 * The roles and providers of a project with status and limit. Components of one project share one
 * subscription: the registry comes again when the runs change it, when the window gets focus and
 * after a write (`invalidateProviders`).
 */
export function useProviderRegistry(api: Api, repository: string | null, level?: RegistryLevel) {
  const key = registryKey(repository, level);
  const subscribe = useCallback(
    (listener: () => void) => watchRegistry(key, api, listener),
    [key, api],
  );
  const state = useSyncExternalStore(subscribe, () => registries.read(key));
  const reload = useCallback(() => registries.reload(key, true), [key]);
  return { view: state.value, failure: state.failure, loading: state.loading, reload };
}

/** The registries of several projects (the mode «All projects», a task for several projects). */
export function useProviderRegistries(
  api: Api,
  repositories: readonly string[],
): { views: (ProvidersView | null)[]; failures: string[] } {
  const joined = repositories.join('\n');
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = joined
        .split('\n')
        .filter((path) => path !== '')
        .map((path) => watchRegistry(path, api.forRepository(path), listener));
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
