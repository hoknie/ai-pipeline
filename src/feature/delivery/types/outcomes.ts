import type { GroupDelivery } from '../../runs/types/index.ts';

/** Answer to `group_file_diff`: the diff of one file of a group, without the file headers. */
export interface FileDiffView {
  path: string;
  previousPath: string | null;
  binary: boolean;
  lines: string[];
  totalLines: number;
  truncated: boolean;
}

/** Answer to `run_patch`: the patch of the merged groups of a run, bytes in base64. */
export interface RunPatchView {
  fileName: string;
  size: number;
  base64: string;
}

/** The delivery of the requested groups, or of the merged ones not delivered yet. */
export interface ApplyResult {
  runId: string;
  pending: boolean;
  groups: { slug: string; delivery: GroupDelivery }[];
}
