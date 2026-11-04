import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { reapAbandoned } from './global-setup.ts';

const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
});

/** A process whose command line ends with `daemon`, like `aip daemon`; resolves once it runs. */
async function fakeDaemon(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'daemon'], {
    stdio: 'ignore',
  });
  children.push(child);
  await new Promise((resolve) => child.once('spawn', resolve));
  return child;
}

function exited(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** A dead pid: a process that has already exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((resolve) => child.once('exit', resolve));
  return child.pid!;
}

/** A run directory `aipt-<name>` with an owner and a sandbox daemon in it. */
function runDirectory(parent: string, name: string, owner: number | null, daemon: number): string {
  const directory = join(parent, `aipt-${name}`);
  const state = join(directory, 'aip-cli-x', 'state', 'aip');
  mkdirSync(state, { recursive: true });
  if (owner !== null) writeFileSync(join(directory, 'owner.pid'), String(owner));
  writeFileSync(join(state, 'aip.pid'), String(daemon));
  return directory;
}

describe('reapAbandoned', () => {
  it('stops the daemons of a run whose vitest is gone and removes its directory', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'aip-reap-'));
    const daemon = await fakeDaemon();
    const directory = runDirectory(parent, 'dead', await deadPid(), daemon.pid!);
    reapAbandoned(parent);
    expect(await exited(daemon, 5_000)).toBe(true);
    expect(existsSync(directory)).toBe(false);
  });

  it('leaves a run still going and a directory without an owner', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'aip-reap-'));
    const daemon = await fakeDaemon();
    const live = runDirectory(parent, 'live', process.pid, daemon.pid!);
    const unknown = runDirectory(parent, 'unknown', null, daemon.pid!);
    reapAbandoned(parent);
    expect(await exited(daemon, 300)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(unknown)).toBe(true);
  });

  it('does not signal a live process that is not a daemon', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'aip-reap-'));
    const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    children.push(other);
    await new Promise((resolve) => other.once('spawn', resolve));
    const directory = runDirectory(parent, 'dead', await deadPid(), other.pid!);
    reapAbandoned(parent);
    expect(await exited(other, 300)).toBe(false);
    expect(existsSync(directory)).toBe(false);
  });
});
