import { useMemo } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ProviderView } from '../../../shared/api/types.ts';
import { useProviderRegistries } from './useProviderRegistry.ts';

/**
 * The providers every one of the projects knows (disabled ones included), with the data of the
 * first project; `loaded` once every registry is here. One project gives its own registry.
 */
export function useCommonProviders(
  api: Api,
  repositories: readonly string[],
): { providers: ProviderView[]; loaded: boolean } {
  const { views } = useProviderRegistries(api, repositories);
  const loaded = views.length > 0 && views.every((view) => view !== null);
  const providers = loaded
    ? views[0]!.providers.filter((provider) =>
        views.every((view) => view!.providers.some((item) => item.slug === provider.slug)),
      )
    : [];
  const key = JSON.stringify(providers);
  // the same list while nothing in it changed: effects that depend on it stay quiet
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => providers, [key]);
  return { providers: stable, loaded };
}
