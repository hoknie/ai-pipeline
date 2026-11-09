import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { isProjectSlug } from '../../../feature/repos/types/index.ts';

/**
 * What a client sends for a repository the user named: a value that looks like a project slug
 * and is not a file or a directory in `cwd` goes to the daemon as a slug; anything else is a path.
 */
export function repositoryArgument(value: string, cwd: string = process.cwd()): string {
  if (isProjectSlug(value) && !existsSync(resolve(cwd, value))) return value;
  return resolve(cwd, value);
}
