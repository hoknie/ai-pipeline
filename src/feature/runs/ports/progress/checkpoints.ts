/** A bounded advisory note from the same step and specialist, kept outside the worktree. */
export interface RunCheckpointsPort {
  checkpoint(params: {
    runId: string;
    group: string;
    step: string;
    specialist: string;
    beforeSeq: number;
  }): Promise<{ seq: number; text: string } | null>;
}
