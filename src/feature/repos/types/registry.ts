import type { ProjectColor } from './project.ts';

/** A git repository of the user the daemon knows about: a project of the registry. */
export interface KnownRepository {
  path: string;
  addedAt: number;
  /** The name the user gave; null shows the directory name. */
  name: string | null;
  /** The short address of the project; null only until the registry is loaded. */
  slug: string | null;
  enabled: boolean;
  color: ProjectColor | null;
}

/** The attributes a request may change; an absent one stays. */
export interface ProjectChanges {
  name?: string | null;
  slug?: string;
  enabled?: boolean;
  color?: string | null;
}
