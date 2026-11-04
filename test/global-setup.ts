import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    temporaryDirectory: string;
    compileCache: string;
  }
}

const PREFIX = 'aipt-';
/** File of the run directory with the pid of the vitest process that owns it. */
const OWNER = 'owner.pid';
/** `aip.pid` of a sandbox lies at most this deep in a run directory: `aip-cli-<id>/state/aip/aip.pid`. */
const PID_FILE_DEPTH = 4;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readPid(file: string): number | null {
  try {
    const pid = Number(readFileSync(file, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** `aip.pid` files under `directory`, without going into repositories. */
function pidFiles(directory: string, depth = PID_FILE_DEPTH): string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isFile()) return entry.name === 'aip.pid' ? [path] : [];
    if (!entry.isDirectory() || depth <= 1 || entry.name === 'repo' || entry.name === '.git') {
      return [];
    }
    return pidFiles(path, depth - 1);
  });
}

/** The process runs an aip daemon (a pid of a dead daemon may belong to another process now). */
function isDaemon(pid: number): boolean {
  try {
    const args = execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' });
    return /(^|\s)daemon(\s|$)/.test(args.trim());
  } catch {
    return false;
  }
}

/**
 * Removes the directories of earlier runs whose vitest process is gone, stopping the daemons they
 * started. A run killed from outside (a cancelled agent step, a timeout, Ctrl-C) runs neither the
 * teardown of its tests nor the one returned below, and the daemons the CLI tests start in the
 * background outlive it. Directories of runs still going (another checkout) stay.
 */
export function reapAbandoned(parent: string): void {
  let names: string[];
  try {
    names = readdirSync(parent).filter((name) => name.startsWith(PREFIX));
  } catch {
    return;
  }
  for (const name of names) {
    const directory = join(parent, name);
    const owner = readPid(join(directory, OWNER));
    if (owner === null || alive(owner)) continue;
    for (const file of pidFiles(directory)) {
      const pid = readPid(file);
      if (pid !== null && pid !== process.pid && alive(pid) && isDaemon(pid)) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // already stopped
        }
      }
    }
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // a stopping daemon may still be removing its files: the next run tries again
    }
  }
}

/**
 * Gives the whole test run one temporary directory and removes it at the end; `test/setup.ts` points
 * `TMPDIR` of every worker at it. Tests, daemons and fake agents create their repositories, state and
 * sockets with `tmpdir()`, so nothing they leave behind outlives the run. The name stays short: a
 * long socket path falls back to a file directly in `tmpdir()`, and it must stay within the Unix
 * socket limit.
 *
 * The tests start hundreds of `node` processes on TypeScript sources (`aip`, the worker MCP server,
 * fake agents); a compile cache shared by them saves the type stripping on every start after the
 * first.
 */
export default function setup(project: TestProject): () => void {
  reapAbandoned(tmpdir());
  const directory = mkdtempSync(join(tmpdir(), PREFIX));
  writeFileSync(join(directory, OWNER), String(process.pid));
  project.provide('temporaryDirectory', directory);
  project.provide(
    'compileCache',
    process.env.NODE_COMPILE_CACHE ?? join(directory, 'node-compile-cache'),
  );
  return () => rmSync(directory, { recursive: true, force: true });
}
