import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProjectRef } from '../../lib/catalog/projectRows.ts';
import type { Api } from '../api.ts';
import type { ConfigEditorResponse } from '../types.ts';

/** The configuration of one project, or the reason it could not be read. */
export interface ProjectConfig {
  project: ProjectRef;
  view: ConfigEditorResponse | null;
  error: string | null;
}

/**
 * The configuration of every project, read in parallel; the failure of one project is kept with
 * it and does not hide the others. `reload` reads them again.
 */
export function useAllProjectsConfig(api: Api, projects: readonly ProjectRef[], enabled = true) {
  const [configs, setConfigs] = useState<ProjectConfig[] | null>(null);
  const latest = useRef(projects);
  latest.current = projects;
  const key = projects.map((project) => project.path).join('\n');
  const reload = useCallback(async () => {
    const chosen = latest.current;
    const next = await Promise.all(
      chosen.map(async (project): Promise<ProjectConfig> => {
        try {
          return { project, view: await api.forRepository(project.path).config(), error: null };
        } catch (error) {
          return { project, view: null, error: (error as Error).message };
        }
      }),
    );
    setConfigs(next);
  }, [api]);
  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload, key]);
  return { configs, reload };
}
