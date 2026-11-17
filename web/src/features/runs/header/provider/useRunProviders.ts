import { useMemo } from 'react';

import type { Api } from '../../../../shared/api/api.ts';
import type { ProviderView, RunView } from '../../../../shared/api/types.ts';
import { useProviderRegistry } from '../../../providers/index.ts';

/**
 * The providers of the registry of the repository of the run, and the API bound to it. Empty until
 * loaded and when the configuration cannot be read.
 */
export function useRunProviders(
  run: RunView,
  api: Api,
): { providers: ProviderView[]; scoped: Api } {
  const { repository } = run;
  const scoped = useMemo(() => api.forRepository(repository), [api, repository]);
  const { view } = useProviderRegistry(scoped, repository);
  return { providers: view?.providers ?? [], scoped };
}
