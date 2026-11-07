export interface RepositoryEntry {
  path: string;
  addedAt: number;
}

export interface RepositoryView {
  path: string;
  /** The path for display: the home directory is written as `~`. */
  displayPath: string;
  addedAt: number;
  /** Runs that are not finished yet. */
  unfinished: number;
  /** Runs waiting for a human answer. */
  waiting: number;
  /** Tasks waiting in the queue. */
  queued: number;
}
