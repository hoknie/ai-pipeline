import { useEffect, useState } from 'react';

import type { Api } from '../../../../shared/api/api.ts';
import type { RunView } from '../../../../shared/api/types.ts';

export interface RunVariant {
  id: string;
  name: string;
}

/**
 * The variants of the pipeline of the run in the current configuration of its repository, `default`
 * first. Empty until loaded and when the configuration cannot be read.
 */
export function useRunVariants(run: RunView, api: Api): RunVariant[] {
  const [variants, setVariants] = useState<RunVariant[]>([]);
  const { repository, pipeline } = run;
  useEffect(() => {
    let alive = true;
    setVariants([]);
    api
      .forRepository(repository)
      .pipelines()
      .then(
        (view) => {
          const found = view.pipelines.find((item) => item.id === pipeline);
          if (alive) setVariants(found?.variants.map(({ id, name }) => ({ id, name })) ?? []);
        },
        () => undefined,
      );
    return () => {
      alive = false;
    };
  }, [api, repository, pipeline]);
  return variants;
}
