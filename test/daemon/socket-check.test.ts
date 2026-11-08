import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startDaemon, type RunningDaemon } from '../../src/app/index.ts';

const root = join(import.meta.dirname, '..', '..');
const fakes = join(root, 'test', 'fakes');

const started: RunningDaemon[] = [];

afterEach(async () => {
  for (const running of started.splice(0)) await running.close();
});

async function daemon(): Promise<{ running: RunningDaemon; base: string; state: string }> {
  // Not resolved through realpath: on macOS `/var` becomes `/private/var`, and the longer path would
  // move the socket out of the state directory (the Unix socket limit), which these tests rely on.
  const base = mkdtempSync(join(tmpdir(), 'aips-'));
  const state = join(base, 'state');
  const running = await startDaemon({
    stateDirectory: state,
    entry: [process.execPath, join(root, 'src', 'cli', 'main.ts')],
    environment: {
      ...process.env,
      XDG_CONFIG_HOME: join(base, 'xdg'),
      AIP_CLAUDE_BIN: join(fakes, 'claude'),
      AIP_OPENCODE_BIN: join(fakes, 'opencode'),
      AIP_AGY_BIN: join(fakes, 'agy'),
    },
    socketCheckMs: 10,
  });
  started.push(running);
  return { running, base, state };
}

/** Resolves when the daemon has stopped; fails after `ms`. */
function stoppedWithin(running: RunningDaemon, ms: number): Promise<void> {
  return Promise.race([
    running.closed,
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`the daemon still runs after ${ms} ms`)), ms),
    ),
  ]);
}

describe('daemon socket check', () => {
  it('keeps running while its socket is in place', async () => {
    const { running } = await daemon();
    const outcome = await Promise.race([
      running.closed.then(() => 'stopped'),
      // five checks of the socket (10 ms each) pass without a stop
      new Promise((resolve) => setTimeout(() => resolve('running'), 50)),
    ]);
    expect(outcome).toBe('running');
  });

  it('stops when its state directory is removed', async () => {
    const { running, base } = await daemon();
    rmSync(base, { recursive: true, force: true });
    await stoppedWithin(running, 2_000);
  });

  it('stops when its socket file is replaced', async () => {
    const { running } = await daemon();
    rmSync(running.application.socket);
    writeFileSync(running.application.socket, 'another');
    await stoppedWithin(running, 2_000);
  });

  it('stops when its lock is taken by another process, and leaves that lock', async () => {
    const { running, state } = await daemon();
    const lock = join(state, 'aip.pid');
    writeFileSync(lock, '999999999');
    await stoppedWithin(running, 2_000);
    expect(readFileSync(lock, 'utf8')).toBe('999999999');
    expect(existsSync(running.application.socket)).toBe(false);
  });
});
