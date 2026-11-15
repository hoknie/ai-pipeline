import { useMemo, useState } from 'react';

import type { RepositoryView } from '../../shared/api/types.ts';
import { enabledProjects } from '../../shared/lib/catalog/projectRows.ts';
import { ChooseProjectDialog } from './ChooseProjectDialog.tsx';

/**
 * The projects the mode «All projects» offers when a new entry is created or imported; absent
 * outside the mode.
 */
export interface ProjectsMode {
  registry: RepositoryView[];
  /** Slug of the project of the open entry (`?project=`); null for a shared one. */
  project: string | null;
  /** The last chosen project of the panel: the first choice of a new entry. */
  last: string | null;
}

/** Where a new entry goes: asks for the project in the mode «All projects», else is immediate. */
export function useNewEntry(
  projects: Pick<ProjectsMode, 'registry' | 'last'> | undefined,
  open: (project: string | null) => void,
) {
  const [asking, setAsking] = useState(false);
  const list = useMemo(() => enabledProjects(projects?.registry ?? []), [projects?.registry]);
  const ask = () => (projects ? setAsking(true) : open(null));
  const dialog = projects ? (
    <ChooseProjectDialog
      open={asking}
      onOpenChange={setAsking}
      repositories={list.map((project) => project.path)}
      initial={projects.last}
      onChoose={(path) => open(list.find((project) => project.path === path)?.slug ?? null)}
    />
  ) : null;
  return { ask, dialog };
}
