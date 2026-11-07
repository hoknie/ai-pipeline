import { useCallback, useEffect, useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import type { SystemStagesResponse } from '../../../shared/lib/pipeline/pipelineEntries.ts';

/** The configuration of the repository and its system stages, with the loading failures. */
export function usePipelinesData(api: Api) {
  const [view, setView] = useState<ConfigEditorResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [stages, setStages] = useState<SystemStagesResponse | null>(null);
  const [stagesFailure, setStagesFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await api.config();
      setView(loaded);
      setFailure(null);
      return loaded;
    } catch (error) {
      setFailure((error as Error).message);
      return null;
    }
  }, [api]);

  const loadStages = useCallback(async () => {
    try {
      setStages(await api.systemStages());
      setStagesFailure(null);
    } catch (error) {
      setStagesFailure((error as Error).message);
    }
  }, [api]);

  useEffect(() => {
    void load();
    void loadStages();
  }, [load, loadStages]);

  const reload = useCallback(async () => {
    await load();
  }, [load]);
  const reloadAll = useCallback(async () => {
    await Promise.all([load(), loadStages()]);
  }, [load, loadStages]);
  return { view, failure, stages, stagesFailure, load, reload, reloadAll };
}

export type PipelinesData = ReturnType<typeof usePipelinesData>;
