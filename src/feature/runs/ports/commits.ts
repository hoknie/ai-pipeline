import type { Run } from '../types/index.ts';

/** What the delivery commit of a run carries: the identity of its author and the final message. */
export interface CommitStamp {
  message: string;
  /** The author of the commit; `null` keeps the git identity of the daemon. */
  identity: { author: { name: string; email: string } | null };
}

/** The server mode puts the author of a run and the co-author trailer on the commit of its delivery. */
export interface RunCommitsPort {
  /** The stamp of the delivery commit of the run, or `null` in the local mode: the commit stays as it is. */
  stamp(run: Run, message: string): CommitStamp | null;
}
