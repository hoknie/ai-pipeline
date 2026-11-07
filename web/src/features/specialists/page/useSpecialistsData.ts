import { useCallback, useEffect, useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigCatalogResponse, ConfigEditorResponse } from '../../../shared/api/types.ts';

/** The configuration and the tool catalog; `load` reads both again. */
export function useSpecialistsData(api: Api) {
  const [view, setView] = useState<ConfigEditorResponse | null>(null);
  const [catalog, setCatalog] = useState<ConfigCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const load = useCallback(async () => {
    // The catalog only helps the form: its failure leaves the lists free to type in.
    const loading = api.catalog().then(
      (value) => ({ value, message: null }),
      (error: Error) => ({ value: null, message: error.message }),
    );
    try {
      setView(await api.config());
      setFailure(null);
    } catch (error) {
      setFailure((error as Error).message);
    }
    const result = await loading;
    setCatalog(result.value);
    setCatalogError(result.message);
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  return { view, catalog, catalogError, failure, load };
}
