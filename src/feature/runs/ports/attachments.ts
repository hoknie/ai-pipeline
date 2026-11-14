import type { Run } from '../types/index.ts';

/** The attachments of a run as files an agent can read. */
export interface RunAttachmentsPort {
  /**
   * Lays the attachments of the run out in a folder outside every worktree and returns it; null
   * for a run without attachments. Throws when the bytes of an attachment are gone.
   */
  materialize(run: Run): Promise<string | null>;
}
