import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';

import { rejected } from '../../../platform/errors/index.ts';
import type { AttachmentRecord } from '../repositories/index.ts';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENTS_PER_TASK,
  attachmentMediaType,
  attachmentNameProblem,
  formatAttachmentSize,
  type AttachmentSource,
} from '../types/index.ts';

/** A file read from disk and checked, ready for the storage. */
export interface PreparedAttachment {
  fileName: string;
  size: number;
  mediaType: string;
  path: string;
}

/**
 * Checks every source before anything is written: absolute path, a regular file, the size, the
 * name, no repeated names and the number of attachments the task ends with.
 */
export function prepareSources(
  sources: AttachmentSource[],
  keptNames: string[],
): PreparedAttachment[] {
  const names = new Set(keptNames);
  const prepared: PreparedAttachment[] = [];
  for (const source of sources) {
    if (!isAbsolute(source.path)) {
      throw rejected(`attachment path must be absolute: \`${source.path}\``);
    }
    let size: number;
    try {
      const stat = statSync(source.path);
      if (!stat.isFile()) throw rejected(`attachment is not a regular file: \`${source.path}\``);
      size = stat.size;
    } catch (error) {
      if ((error as { kind?: string }).kind !== undefined) throw error;
      throw rejected(`attachment file is not readable: \`${source.path}\``);
    }
    const fileName = source.name ?? basename(source.path);
    const problem = attachmentNameProblem(fileName);
    if (problem !== null) throw rejected(problem);
    if (size > ATTACHMENT_MAX_BYTES) {
      throw rejected(
        `attachment \`${fileName}\` is ${formatAttachmentSize(size)}; the limit is ${formatAttachmentSize(ATTACHMENT_MAX_BYTES)}`,
      );
    }
    if (names.has(fileName)) throw rejected(`attachment name \`${fileName}\` is repeated`);
    names.add(fileName);
    prepared.push({ fileName, size, mediaType: attachmentMediaType(fileName), path: source.path });
  }
  if (names.size > ATTACHMENTS_PER_TASK) {
    throw rejected(`a task may have at most ${ATTACHMENTS_PER_TASK} attachments`);
  }
  return prepared;
}

/** The bytes of a prepared file; a file that grew past the limit meanwhile is refused. */
export async function readPrepared(file: PreparedAttachment): Promise<Buffer> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file.path);
  } catch {
    throw rejected(`attachment file is not readable: \`${file.path}\``);
  }
  if (bytes.length > ATTACHMENT_MAX_BYTES) {
    throw rejected(`attachment \`${file.fileName}\` is larger than the limit`);
  }
  return bytes;
}

export function newRecord(
  file: PreparedAttachment,
  bytes: Buffer,
  context: { repository: string; itemId: string; uri: string; id: string; now: number },
): AttachmentRecord {
  return {
    id: context.id,
    repository: context.repository,
    itemId: context.itemId,
    runId: null,
    fileName: file.fileName,
    size: bytes.length,
    mediaType: file.mediaType,
    uri: context.uri,
    createdAt: context.now,
  };
}

export function newAttachmentId(): string {
  return randomUUID();
}
