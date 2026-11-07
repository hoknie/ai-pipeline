import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { packageRoot } from '../../../platform/build/index.ts';
import { findExecutable } from '../../../platform/process/index.ts';

import type { SetupDeps } from './types.ts';

export function systemDeps(env: NodeJS.ProcessEnv): SetupDeps {
  return {
    env,
    root: packageRoot(),
    exec: (bin, args) =>
      new Promise((resolve) => {
        execFile(bin, args, { timeout: 120_000, env }, (error, stdout, stderr) =>
          resolve({
            code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            stdout: String(stdout),
            stderr:
              String(stderr) || (error && typeof error.code !== 'number' ? error.message : ''),
          }),
        );
      }),
    find: (name) => findExecutable(name, env.PATH),
    realpath: (path) => realpathSync(path),
    readFile: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    writeFile: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
    exists: (path) => existsSync(path),
  };
}

/** Whether `root` is a temporary `npx` copy of the package. */
export function isNpxCache(root: string, env: NodeJS.ProcessEnv): boolean {
  if (/[\\/]_npx[\\/]/.test(root)) return true;
  const cache = env.npm_config_cache;
  return Boolean(cache) && root.startsWith(`${cache}/`);
}

/**
 * The command that starts aip for a host: `aip` when the `aip` in PATH is this installation,
 * otherwise Node.js with the absolute path of this installation's CLI.
 */
export function resolveAipCommand(deps: SetupDeps): string[] {
  const built = join(deps.root, 'dist', 'cli', 'main.js');
  const entry = deps.exists(built) ? built : (process.argv[1] ?? built);
  const found = deps.find('aip');
  if (found) {
    try {
      if (deps.realpath(found) === deps.realpath(entry)) return ['aip'];
    } catch {
      // A dangling link: fall through to the absolute path.
    }
  }
  return [process.execPath, entry];
}
