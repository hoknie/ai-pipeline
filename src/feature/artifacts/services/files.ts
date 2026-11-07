import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

import { rejected } from '../../../platform/errors/index.ts';
import { ARTIFACT_FILE_LIMIT } from '../types/index.ts';

/** Reads a regular file inside the worktree (symlinks resolved, `.git` excluded), size-limited. */
export async function readArtifactFile(worktree: string, path: string): Promise<Buffer> {
  let root: string;
  let target: string;
  try {
    root = await realpath(worktree);
    target = await realpath(isAbsolute(path) ? path : resolve(root, path));
  } catch {
    throw rejected(`cannot read \`${path}\`: no such file in the worktree`);
  }
  const inside = target.startsWith(root + sep) ? target.slice(root.length + 1) : null;
  if (inside === null || inside.split(sep)[0] === '.git') {
    throw rejected(`\`${path}\` is outside of the worktree of the group`);
  }
  const before = await stat(target);
  if (!before.isFile()) throw rejected(`\`${path}\` is not a regular file`);
  if (before.size > ARTIFACT_FILE_LIMIT) {
    throw rejected(`\`${path}\` is larger than ${ARTIFACT_FILE_LIMIT} bytes`);
  }
  const handle = await open(target, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw rejected(`\`${path}\` is not a regular file`);
    if (info.size > ARTIFACT_FILE_LIMIT) {
      throw rejected(`\`${path}\` is larger than ${ARTIFACT_FILE_LIMIT} bytes`);
    }
    const buffer = Buffer.alloc(Math.min(info.size, ARTIFACT_FILE_LIMIT));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
