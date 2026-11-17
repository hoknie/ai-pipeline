import { useEffect, useState } from 'react';

import type { Api } from '../../../../shared/api/api.ts';
import type { RunView } from '../../../../shared/api/types.ts';

/**
 * The providers of the tiers in the current configuration of the repository of the run. Empty until
 * loaded and when the configuration cannot be read.
 */
export function useRunProviders(run: RunView, api: Api): string[] {
  const [providers, setProviders] = useState<string[]>([]);
  const { repository } = run;
  useEffect(() => {
    let alive = true;
    setProviders([]);
    api
      .forRepository(repository)
      .pipelines()
      .then(
        (view) => {
          if (alive) setProviders(view.providers ?? []);
        },
        () => undefined,
      );
    return () => {
      alive = false;
    };
  }, [api, repository]);
  return providers;
}
