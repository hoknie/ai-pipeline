import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { Api } from '../../api/api.ts';
import type { ConfigModelsResponse, RuntimeModels } from '../../api/types.ts';

/** The models of every runtime as the panel knows them; `null` until they are asked for. */
export interface ModelCatalog {
  catalog: ConfigModelsResponse | null;
  /** Why the request failed; the fields stay free to type in. */
  error: string | null;
  loading: boolean;
  /** Asks for the models once; the fields call it when they appear. */
  ensure: () => void;
  /** Asks the runtimes again and replaces the list in every field. */
  refresh: () => void;
}

const IDLE: ModelCatalog = {
  catalog: null,
  error: null,
  loading: false,
  ensure: () => {},
  refresh: () => {},
};

const ModelCatalogContext = createContext<ModelCatalog>(IDLE);

/** The state behind the provider: loads on the first `ensure`, again on `refresh`. */
export function useModelCatalogState(api: Api): ModelCatalog {
  const [catalog, setCatalog] = useState<ConfigModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const started = useRef(false);
  const generation = useRef(0);
  const load = useCallback(
    (refresh: boolean) => {
      started.current = true;
      const mine = ++generation.current;
      setLoading(true);
      api.models(refresh).then(
        (value) => {
          if (generation.current !== mine) return;
          setCatalog(value);
          setError(null);
          setLoading(false);
        },
        (failure: Error) => {
          if (generation.current !== mine) return;
          setError(failure.message);
          setLoading(false);
        },
      );
    },
    [api],
  );
  const ensure = useCallback(() => {
    if (!started.current) load(false);
  }, [load]);
  const refresh = useCallback(() => load(true), [load]);
  return useMemo(
    () => ({ catalog, error, loading, ensure, refresh }),
    [catalog, error, loading, ensure, refresh],
  );
}

export function ModelCatalogProvider({ api, children }: { api: Api; children: ReactNode }) {
  const value = useModelCatalogState(api);
  return <ModelCatalogContext value={value}>{children}</ModelCatalogContext>;
}

export function useModelCatalog(): ModelCatalog {
  return useContext(ModelCatalogContext);
}

export function modelsOf(
  catalog: ConfigModelsResponse | null,
  runtime: string,
): RuntimeModels | null {
  if (runtime === 'claude' || runtime === 'opencode' || runtime === 'agy') {
    return catalog?.runtimes[runtime] ?? null;
  }
  return null;
}
