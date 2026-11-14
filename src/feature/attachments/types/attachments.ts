import type { RunAttachment } from '../../runs/types/index.ts';

/** The most attachments a task may have. */
export const ATTACHMENTS_PER_TASK = 10;

/** The largest attachment: 20 MiB. */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/** A file attached to a task: what lists and views show; the bytes live in the storage. */
export type AttachmentRef = RunAttachment;

/** A file to attach: an absolute path, and the name that replaces its base name. */
export interface AttachmentSource {
  path: string;
  name?: string | undefined;
}

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  md: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  json: 'application/json',
  csv: 'text/csv',
  html: 'text/html',
  zip: 'application/zip',
};

/** Why a name cannot be the name of an attachment; null when it can. */
export function attachmentNameProblem(name: string): string | null {
  if (name === '' || name === '.' || name === '..') return `invalid attachment name \`${name}\``;
  // eslint-disable-next-line no-control-regex
  if (/[/\\\u0000-\u001f\u007f]/.test(name)) return `invalid attachment name \`${name}\``;
  return null;
}

/** The content type by the extension of the file name; unknown ones are `application/octet-stream`. */
export function attachmentMediaType(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return MEDIA_TYPES[fileName.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

/** `512 B`, `2.0 KB`, `1.5 MB`. */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What the daemon still holds: the attachments of anything else are swept. */
export interface AttachmentsLiveness {
  /** Ids of the queue items that exist. */
  items: Set<string>;
  /** Whether the run is kept. */
  hasRun(id: string): boolean;
}
