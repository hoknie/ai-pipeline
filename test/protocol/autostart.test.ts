import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { lockPath, socketPath } from '../../src/platform/paths/index.ts';
import { startDaemon, type RunningDaemon } from '../../src/app/index.ts';
import { currentBuild, fingerprintTree, type BuildInfo } from '../../src/platform/build/index.ts';
import {
  daemonMismatchMessage,
  ensureDaemon,
  pingDaemon,
  request,
  stopDaemon,
} from '../../src/presentation/ipc/client/index.ts';
import type { RunCreated } from '../../src/presentation/ipc/contract/index.ts';
import { harness, startRun, type Harness } from '../daemon/harness.ts';

const root = join(import.meta.dirname, '..', '..');
const entry = [process.execPath, join(root, 'src', 'cli', 'main.ts')];

const OLD: BuildInfo = { version: '0.0.1', fingerprint: 'old', builtAt: 1 };

const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined);
});

async function started(options: Parameters<typeof harness>[2]): Promise<Harness> {
  const h = await harness(undefined, {}, options);
  cleanups.push(() => h.close());
  return h;
}

describe('build fingerprint', () => {
  it('changes with the contents of a file and stays the same otherwise', () => {
    const tree = mkdtempSync(join(tmpdir(), 'aip-build-'));
    mkdirSync(join(tree, 'cli'));
    writeFileSync(join(tree, 'cli', 'main.js'), 'one');
    writeFileSync(join(tree, 'index.js'), 'two');
    const first = fingerprintTree(tree);
    expect(fingerprintTree(tree).fingerprint).toBe(first.fingerprint);
    writeFileSync(join(tree, 'cli', 'main.js'), 'changed');
    expect(fingerprintTree(tree).fingerprint).not.toBe(first.fingerprint);
  });

  it('is reported by the daemon in ping', async () => {
    const h = await started({});
    expect(await pingDaemon(h.socket)).toMatchObject({
      pid: process.pid,
      build: currentBuild(),
      busy: false,
    });
  });
});

describe('ensureDaemon and the build of the daemon', () => {
  it('leaves a daemon of the same build alone', async () => {
    const h = await started({});
    const check = await ensureDaemon(h.socket, ['false']);
    expect(check).toEqual({ started: false, restarted: false, mismatch: null });
  });

  it('replaces an older idle daemon with one of its own build', async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-restart-')));
    const state = join(base, 'aip');
    const environment = {
      ...process.env,
      XDG_STATE_HOME: base,
      XDG_CONFIG_HOME: join(base, 'config'),
      AIP_WEB_AUTOSTART: '0',
      AIP_CLAUDE_BIN: join(root, 'test', 'fakes', 'claude'),
      AIP_OPENCODE_BIN: join(root, 'test', 'fakes', 'opencode'),
      AIP_AGY_BIN: join(root, 'test', 'fakes', 'agy'),
    };
    const old: RunningDaemon = await startDaemon({
      stateDirectory: state,
      entry,
      environment,
      build: OLD,
    });
    cleanups.push(() => old.close());
    const socket = socketPath(state);
    cleanups.push(() => request(socket, 'shutdown', {}));
    const check = await ensureDaemon(socket, entry, {
      environment,
      lockPath: lockPath(state),
      timeoutMs: 15_000,
    });
    expect(check).toEqual({ started: true, restarted: true, mismatch: null });
    await old.closed;
    const ping = await pingDaemon(socket);
    expect(ping?.build).toEqual(currentBuild());
    expect(ping?.pid).not.toBe(process.pid);
  }, 30_000);

  it('keeps an older daemon whose agents run and reports it', async () => {
    const h = await started({ build: OLD });
    h.script({ code: [{ hang: true }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    const check = await ensureDaemon(h.socket, ['false']);
    expect(check).toMatchObject({
      started: false,
      restarted: false,
      mismatch: { outdated: 'daemon', pid: process.pid, daemon: OLD, busy: true },
    });
    expect(daemonMismatchMessage(check, 'aip')).toContain(
      'restarts it once its agents finish, or run `aip daemon restart --force` now',
    );
    expect(await pingDaemon(h.socket)).toMatchObject({ busy: true });
    await h.call('cancel', { runId });
  });

  it('keeps a newer daemon and tells the client to restart', async () => {
    const newer = { version: '9.9.9', fingerprint: 'newer', builtAt: Date.now() + 60_000 };
    const h = await started({ build: newer });
    const check = await ensureDaemon(h.socket, ['false']);
    expect(check.mismatch).toMatchObject({ outdated: 'client', daemon: newer });
    expect(daemonMismatchMessage(check, 'aip web')).toMatch(
      /runs a newer build \(9\.9\.9, build newer\) than this aip web .*; restart aip web$/,
    );
    expect(await pingDaemon(h.socket)).not.toBeNull();
  });

  it('never asks a daemon without the build check to stop', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-legacy-'));
    const socket = join(directory, 'aip.sock');
    const methods: string[] = [];
    const server: Server = createServer((connection) => {
      connection.setEncoding('utf8');
      connection.on('data', (line: string) => {
        const { id, method } = JSON.parse(line) as { id: number; method: string };
        methods.push(method);
        connection.end(`${JSON.stringify({ id, ok: true, result: { pong: true, pid: 4242 } })}\n`);
      });
    });
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    cleanups.push(() => new Promise((resolve) => server.close(resolve)));
    const check = await ensureDaemon(socket, ['false']);
    expect(check.mismatch).toMatchObject({ outdated: 'daemon', pid: 4242, daemon: null });
    expect(methods).toEqual(['ping']);
    expect(daemonMismatchMessage(check, 'aip')).toContain(
      'it cannot be restarted automatically: run `aip daemon restart --force`',
    );
  });
});

// The daemon of the harness lives in this process, which stays alive: it holds no lock file.
const NO_LOCK = join(tmpdir(), 'aip-no-such-lock');

describe('stopDaemon', () => {
  it('reports a missing daemon', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-stop-'));
    expect(await stopDaemon(join(directory, 'aip.sock'))).toEqual({ state: 'not_running' });
  });

  it('stops an idle daemon and waits until it is gone', async () => {
    const h = await started({});
    expect(await stopDaemon(h.socket, { lockPath: NO_LOCK })).toEqual({
      state: 'stopped',
      pid: process.pid,
    });
    expect(await pingDaemon(h.socket)).toBeNull();
  });

  it('keeps a busy daemon unless forced', async () => {
    const h = await started({});
    h.script({ code: [{ hang: true }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    expect(await stopDaemon(h.socket, { lockPath: NO_LOCK })).toEqual({
      state: 'busy',
      pid: process.pid,
    });
    expect(await pingDaemon(h.socket)).not.toBeNull();
    expect(await stopDaemon(h.socket, { force: true, lockPath: NO_LOCK })).toEqual({
      state: 'stopped',
      pid: process.pid,
    });
    expect(await pingDaemon(h.socket)).toBeNull();
  });
});
