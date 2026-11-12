import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

import { expandHome } from '../../../platform/paths/index.ts';
import { panel } from '../errors.ts';

/** How many subdirectories one answer lists at most. */
export const DIRECTORY_LIMIT = 500;

export interface DirectoryEntry {
  name: string;
  path: string;
  /** The directory holds `.git`: it is the root of a repository. */
  git: boolean;
}

export interface DirectoryListing {
  path: string;
  /** The parent directory; null at the root of the file system. */
  parent: string | null;
  home: string;
  git: boolean;
  /** Subdirectories by name, hidden ones left out. */
  entries: DirectoryEntry[];
  /** More subdirectories than `DIRECTORY_LIMIT` exist. */
  truncated: boolean;
}

const isRepositoryRoot = (path: string): boolean => existsSync(join(path, '.git'));

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The subdirectories of a directory for the path picker of the panel; `~` is the home directory. */
export function listDirectory(
  requested: string | null,
  home: string = homedir(),
): DirectoryListing {
  const path =
    requested === null || requested.trim() === '' ? home : expandHome(requested.trim(), home);
  if (!isAbsolute(path)) throw panel('invalid', 'path must be absolute or start with ~');
  if (!isDirectory(path)) throw panel('not_found', `${path} is not a directory`);
  let names: string[];
  try {
    names = readdirSync(path, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .filter(
        (entry) =>
          entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(join(path, entry.name))),
      )
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }));
  } catch {
    throw panel('forbidden', `cannot read ${path}`);
  }
  const parent = dirname(path);
  return {
    path,
    parent: parent === path ? null : parent,
    home,
    git: isRepositoryRoot(path),
    entries: names.slice(0, DIRECTORY_LIMIT).map((name) => {
      const child = join(path, name);
      return { name, path: child, git: isRepositoryRoot(child) };
    }),
    truncated: names.length > DIRECTORY_LIMIT,
  };
}
