import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Gives the whole test run one temporary directory and removes it at the end. Tests, daemons and
 * fake agents create their repositories, state and sockets with `tmpdir()`, which follows `TMPDIR`,
 * so nothing they leave behind outlives the run. The name stays short: a long socket path falls
 * back to a file directly in `tmpdir()`, and it must stay within the Unix socket limit.
 */
export default function setup(): () => void {
  const directory = mkdtempSync(join(tmpdir(), 'aipt-'));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = directory;
  return () => {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    rmSync(directory, { recursive: true, force: true });
  };
}
