import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    temporaryDirectory: string;
    compileCache: string;
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
  const directory = mkdtempSync(join(tmpdir(), 'aipt-'));
  project.provide('temporaryDirectory', directory);
  project.provide(
    'compileCache',
    process.env.NODE_COMPILE_CACHE ?? join(directory, 'node-compile-cache'),
  );
  return () => rmSync(directory, { recursive: true, force: true });
}
