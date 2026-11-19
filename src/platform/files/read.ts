import { readFileSync, statSync } from 'node:fs';

import { expandHome } from '../paths/index.ts';

/** The text of a file; a leading `~` is the home directory. Throws the system error when it cannot be read. */
export function readTextFile(path: string): string {
  return readFileSync(expandHome(path), 'utf8');
}

/** Why the file cannot be used (missing, a directory, no access, empty), or `null` when it can. */
export function textFileProblem(path: string): string | null {
  try {
    const full = expandHome(path);
    if (!statSync(full).isFile()) return 'must be a file';
    return readFileSync(full, 'utf8').trim() === '' ? 'must not be an empty file' : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' ? 'the file does not exist' : `the file cannot be read (${code})`;
  }
}
