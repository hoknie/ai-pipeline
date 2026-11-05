/** Limits and pure helpers for step artifacts: files a specialist publishes outside of git. */

export const ARTIFACT_FILE_NAME_LIMIT = 200;
export const ARTIFACT_TITLE_LIMIT = 200;
/** Text passed inline (`content`). */
export const ARTIFACT_CONTENT_LIMIT = 1024 * 1024;
/** A file read from the worktree (`path`). */
export const ARTIFACT_FILE_LIMIT = 16 * 1024 * 1024;
export const ARTIFACTS_PER_GROUP = 200;
/** The biggest artifact the panel shows as a preview. */
export const ARTIFACT_PREVIEW_LIMIT = 1024 * 1024;

export type ArtifactPreview = 'markdown' | 'log';

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** How the panel previews the file: Markdown, plain log text, or not at all (download only). */
export function artifactPreview(fileName: string): ArtifactPreview | null {
  const extension = extensionOf(fileName);
  if (extension === 'md') return 'markdown';
  if (extension === 'log') return 'log';
  return null;
}

/** The default title of an artifact: the file name without the last extension. */
export function artifactTitle(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? fileName : fileName.slice(0, dot);
}

/** A plain file name: no path separators, no NUL, not `.`/`..`, within the length limit. */
export function validArtifactFileName(name: string): boolean {
  if (name.length === 0 || name.length > ARTIFACT_FILE_NAME_LIMIT) return false;
  if (name === '.' || name === '..') return false;
  return !/[/\\\0]/.test(name) && name.trim() === name;
}
