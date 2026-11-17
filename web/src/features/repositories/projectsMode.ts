import type { RepositoryView } from '../../shared/api/types.ts';

/**
 * The mode «All projects» of the lists of the swarm window: the lists group the entries of the
 * enabled projects and only show them; absent outside the mode.
 */
export interface ProjectsMode {
  registry: RepositoryView[];
  /** Slug of the project of the address (`?project=`): its block of the overview is highlighted. */
  project: string | null;
}
