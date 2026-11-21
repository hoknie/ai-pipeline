import { useCallback } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ProvidersView, WriteLevel } from '../../../shared/api/types.ts';
import { editFailure } from '../matrix/useCellWrite.ts';
import { levelOf, useProvidersScope } from '../page/scope.ts';
import type { ProvidersScope } from '../page/sources.ts';
import {
  invalidateProviders,
  useProviderEditor,
  useProviderRegistry,
} from '../page/useProviderRegistry.ts';

/** The level of settings.yaml the default provider of a scope is written to. */
export const writeLevelOf = (scope: ProvidersScope): WriteLevel =>
  scope === 'global' ? 'global' : 'project';

/** The name of a provider of the registry; the slug while the registry does not list it. */
export function providerNameOf(view: ProvidersView | null, slug: string): string {
  return view?.providers.find((provider) => provider.slug === slug)?.name || slug;
}

/**
 * The default provider of the scope (`default_provider` of settings.yaml) and the writes of it:
 * `assign` sets it, `clear` removes the key of the level. A write resolves to the error text, or
 * to null once the daemon accepted it; the registry is read again after it. The hook knows
 * nothing about dialogs: the component that asks the user calls `assign`.
 */
export function useDefaultProvider(api: Api, repository: string | null) {
  const scope = useProvidersScope();
  const { view } = useProviderRegistry(api, repository, levelOf(scope));
  const { editor } = useProviderEditor(api, repository);
  const write = useCallback(
    async (slug: string | null, level: WriteLevel): Promise<string | null> => {
      try {
        const revision = editor?.settingsFiles[level].revision ?? null;
        const result = await api.writeSetting('default_provider', slug, revision, level);
        await invalidateProviders(repository);
        return result.ok ? null : editFailure(result);
      } catch (error) {
        return (error as Error).message;
      }
    },
    [api, editor, repository],
  );
  const level = writeLevelOf(scope);
  const current = view?.defaultProvider ?? null;
  return {
    scope,
    view,
    current,
    currentName: current === null ? null : providerNameOf(view, current.slug),
    ready: view !== null && editor !== null,
    assign: (slug: string, at: WriteLevel = level) => write(slug, at),
    clear: () => write(null, level),
  };
}

export type DefaultProviderState = ReturnType<typeof useDefaultProvider>;
