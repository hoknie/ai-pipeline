import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { codeRoot, packageVersion } from './locations.ts';

/** The build of aip a process runs: the daemon and its clients must run the same one. */
export interface BuildInfo {
  /** Version from package.json; the same for every rebuild until it is bumped. */
  version: string;
  /** Hash of every file of the code tree the process runs (`dist/` or `src/`). */
  fingerprint: string;
  /** Latest modification time of those files, ms since the epoch: tells the newer build. */
  builtAt: number;
}

/** Hashes a code tree: the relative path and the contents of every file, in a stable order. */
export function fingerprintTree(root: string): { fingerprint: string; builtAt: number } {
  const hash = createHash('sha256');
  let builtAt = 0;
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        hash.update(relative(root, path)).update('\0').update(readFileSync(path)).update('\0');
        builtAt = Math.max(builtAt, statSync(path).mtimeMs);
      }
    }
  };
  visit(root);
  return { fingerprint: hash.digest('hex').slice(0, 16), builtAt: Math.floor(builtAt) };
}

let current: BuildInfo | undefined;

/**
 * Build of this process, computed once on first use: a daemon keeps the build it started with
 * even when the files are rebuilt under it.
 */
export function currentBuild(): BuildInfo {
  current ??= {
    version: packageVersion(),
    ...fingerprintTree(codeRoot()),
  };
  return current;
}
