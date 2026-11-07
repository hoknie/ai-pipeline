/** One artifact in the list of a group (`group_artifacts`). */
export interface ArtifactView {
  id: string;
  /** Pipeline step of the attempt that published it. */
  step: string;
  stepName: string;
  /** Number of that attempt. */
  seq: number;
  specialist: string;
  title: string;
  fileName: string;
  size: number;
  createdAt: number;
  /** How the panel previews the file; null: download only. */
  preview: 'markdown' | 'log' | null;
}

/** Answer to `artifact`: the bytes of one artifact in base64. */
export interface ArtifactContentView {
  fileName: string;
  size: number;
  base64: string;
}
