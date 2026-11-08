import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Resolve symlinks even for a file not created yet; an unreadable ancestor is not permission. */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try {
      if (lstatSync(path).isSymbolicLink())
        return canonical(resolve(dirname(path), readlinkSync(path)));
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code !== 'ENOENT') throw missing;
    }
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(canonical(parent), relative(parent, path));
  }
}

export function insideWorktree(root: string, path: unknown): boolean {
  if (typeof path !== 'string' || !path || !isAbsolute(path)) return false;
  try {
    const diff = relative(canonical(root), canonical(path));
    return diff === '' || (!isAbsolute(diff) && diff !== '..' && !diff.startsWith(`..${sep}`));
  } catch {
    return false;
  }
}
