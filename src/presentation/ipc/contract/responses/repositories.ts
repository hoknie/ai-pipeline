export interface RepositoryEntry {
  path: string;
  addedAt: number;
  name: string | null;
  slug: string | null;
  enabled: boolean;
  color: string | null;
}

export interface RepositoryView {
  path: string;
  /** The path for display: the home directory is written as `~`. */
  displayPath: string;
  addedAt: number;
  /** The name the user gave the project; null without one. */
  name: string | null;
  /** The name the project shows: its own or the directory name. */
  label: string;
  /** The short address of the project, accepted instead of the path. */
  slug: string;
  /** A disabled project takes no new runs or tasks and is hidden in the pickers of the panel. */
  enabled: boolean;
  /** A color of the tag palette; null without one. */
  color: string | null;
  /** Runs that are not finished yet. */
  unfinished: number;
  /** Runs waiting for a human answer. */
  waiting: number;
  /** Tasks waiting in the queue. */
  queued: number;
}
