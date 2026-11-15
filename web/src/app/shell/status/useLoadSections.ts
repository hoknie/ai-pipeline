import { useMemo } from 'react';

import type { RunView } from '../../../shared/api/types.ts';
import { loadSections, machineLoad } from '../../../shared/lib/pipeline/specialistLoad.ts';

/** The blocks of the load of specialists; with `allProjects` no repository comes first. */
export function useLoadSections(runs: RunView[], selected: string | null, allProjects: boolean) {
  return useMemo(
    () => loadSections(machineLoad(runs), selected, allProjects),
    [runs, selected, allProjects],
  );
}
