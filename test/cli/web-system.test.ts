import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDaemonPanel } from '../../src/cli/web/daemon-panel.ts';
import { startWebServer, type WebServer } from '../../src/cli/web/server.ts';
import { spawnDaemonRestart, systemView } from '../../src/cli/web/system.ts';
import { MANUAL_CONFIG, harness, startRun, until, type Harness } from '../daemon/harness.ts';

const BUILD = { version: '1.2.3', fingerprint: 'abc', builtAt: 1 };
const JSON_TYPE = { 'content-type': 'application/json' };

describe('systemView', () => {
  const panel = { pid: 7, host: '127.0.0.1', port: 7341, auth: 'token' as const };

  it('reports the daemon and the panel, and cuts the token out of the address', () => {
    const view = systemView({
      ping: { pong: true, pid: 5, busy: true, build: BUILD },
      check: null,
      panelBuild: BUILD,
      servedBy: 'daemon',
      panel,
      logPath: '/state/daemon.log',
    });
    expect(view.daemon).toEqual({
      running: true,
      pid: 5,
      version: '1.2.3',
      build: 'abc',
      busy: true,
      mismatch: null,
    });
    expect(view.web).toMatchObject({ pid: 7, url: 'http://127.0.0.1:7341/', servedBy: 'daemon' });
    expect(JSON.stringify(view)).not.toContain('token=');
  });

  it('marks a missing daemon, a build mismatch and a standalone panel', () => {
    const none = systemView({
      ping: null,
      check: null,
      panelBuild: BUILD,
      servedBy: 'standalone',
      panel: { ...panel, host: '::1' },
      logPath: null,
    });
    expect(none.daemon).toMatchObject({ running: false, pid: null, busy: null });
    expect(none.web).toMatchObject({ servedBy: 'standalone', url: 'http://[::1]:7341/' });
    const mismatch = systemView({
      ping: { pong: true, pid: 5, build: BUILD },
      check: {
        started: false,
        restarted: false,
        mismatch: { outdated: 'daemon', pid: 5, daemon: BUILD, client: BUILD, busy: false },
      },
      panelBuild: BUILD,
      servedBy: 'daemon',
      panel,
      logPath: null,
    });
    expect(mismatch.daemon.mismatch).toBe('daemon');
  });
});

describe('spawnDaemonRestart', () => {
  it('runs aip daemon restart --web [--force] detached, with the output in daemon.log', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aip-spawn-'));
    const script = join(dir, 'fake.mjs');
    writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)));\n');
    const state = join(dir, 'state');
    for (const force of [false, true]) {
      spawnDaemonRestart({ entry: [process.execPath, script], stateDirectory: state, force });
      const expected = ['daemon', 'restart', '--web', ...(force ? ['--force'] : [])];
      await until(
        'the helper to write its arguments',
        () => readFileSync(join(state, 'daemon.log'), 'utf8').includes(JSON.stringify(expected)),
        5000,
      );
    }
  });
});

let h: Harness | null = null;
let web: WebServer | null = null;

afterEach(async () => {
  await web?.close();
  await h?.close();
  web = null;
  h = null;
});

function post(base: string, path: string, token: string | null, body: unknown = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { ...JSON_TYPE, ...(token === null ? {} : { 'x-aip-token': token }) },
    body: JSON.stringify(body),
  });
}

describe('/api/system', () => {
  it('answers the state of the daemon and the panel', async () => {
    h = await harness(MANUAL_CONFIG);
    web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
    const base = `http://127.0.0.1:${web.port}`;
    expect((await fetch(`${base}/api/system`)).status).toBe(401);
    const response = await fetch(`${base}/api/system`, { headers: { 'x-aip-token': web.token! } });
    expect(response.status).toBe(200);
    const view = (await response.json()) as ReturnType<typeof systemView>;
    expect(view.daemon).toMatchObject({ running: true, busy: false });
    expect(view.web).toMatchObject({
      pid: process.pid,
      port: web.port,
      url: `http://127.0.0.1:${web.port}/`,
      servedBy: 'standalone',
    });
    expect(JSON.stringify(view)).not.toContain(web.token!);
  });

  it('refuses both restarts of a standalone panel with web_standalone', async () => {
    h = await harness(MANUAL_CONFIG);
    web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo });
    const base = `http://127.0.0.1:${web.port}`;
    for (const path of ['/api/system/web/restart', '/api/system/daemon/restart']) {
      const response = await post(base, path, web.token);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'web_standalone' });
    }
  });

  it('answers 202 and runs the hook after the response; 401 runs nothing', async () => {
    h = await harness(MANUAL_CONFIG);
    const calls: string[] = [];
    web = await startWebServer({
      socket: h.socket,
      port: 0,
      repository: h.repo,
      system: {
        restartWeb: async () => void calls.push('web'),
        restartDaemon: async (force) => void calls.push(`daemon:${force}`),
        logPath: '/state/daemon.log',
      },
    });
    const base = `http://127.0.0.1:${web.port}`;
    expect((await post(base, '/api/system/web/restart', null)).status).toBe(401);
    expect((await post(base, '/api/system/daemon/restart', 'wrong')).status).toBe(401);
    expect(calls).toEqual([]);
    const restarting = await post(base, '/api/system/web/restart', web.token);
    expect(restarting.status).toBe(202);
    expect(await restarting.json()).toEqual({ state: 'restarting' });
    await until('the web hook', () => calls.includes('web'), 2000);
    const daemon = await post(base, '/api/system/daemon/restart', web.token);
    expect(daemon.status).toBe(202);
    await until('the daemon hook', () => calls.includes('daemon:false'), 2000);
    const view = (await (
      await fetch(`${base}/api/system`, { headers: { 'x-aip-token': web.token! } })
    ).json()) as ReturnType<typeof systemView>;
    expect(view.web.servedBy).toBe('daemon');
    expect(view.logPath).toBe('/state/daemon.log');
    expect((await post(base, '/api/system/daemon/restart', web.token, { force: 1 })).status).toBe(
      400,
    );
  });

  it('answers 409 daemon_busy for a busy daemon unless force is set', async () => {
    h = await harness(MANUAL_CONFIG);
    h.script({ code: [{ waitFor: h.gate('code') }] });
    await startRun(h, { workflow: 'feature', task: 'x', repository: h.repo });
    const calls: boolean[] = [];
    web = await startWebServer({
      socket: h.socket,
      port: 0,
      repository: h.repo,
      system: {
        restartWeb: async () => undefined,
        restartDaemon: async (force) => void calls.push(force),
      },
    });
    const base = `http://127.0.0.1:${web.port}`;
    await until(
      'the daemon to be busy',
      async () =>
        (
          (await (
            await fetch(`${base}/api/system`, { headers: { 'x-aip-token': web!.token! } })
          ).json()) as ReturnType<typeof systemView>
        ).daemon.busy === true,
      5000,
    );
    const refused = await post(base, '/api/system/daemon/restart', web.token);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'daemon_busy' });
    expect(calls).toEqual([]);
    const forced = await post(base, '/api/system/daemon/restart', web.token, { force: true });
    expect(forced.status).toBe(202);
    await until('the forced hook', () => calls.length === 1, 2000);
    expect(calls).toEqual([true]);
    h.open('code');
  });
});

describe('restart from the panel of the daemon', () => {
  async function freePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }

  it('brings the panel back on the same port with the same token', async () => {
    h = await harness(MANUAL_CONFIG);
    const config = mkdtempSync(join(tmpdir(), 'aip-system-config-'));
    mkdirSync(join(config, 'aip'));
    const port = await freePort();
    writeFileSync(join(config, 'aip', 'settings.yaml'), `web: { port: ${port} }\n`);
    const spawned: { entry: string[]; force: boolean; token: string | undefined }[] = [];
    const controller = createDaemonPanel({
      stateDirectory: h.state,
      socket: h.socket,
      environment: { XDG_CONFIG_HOME: config },
      entry: ['node', 'aip.js'],
      spawnRestart: (options) =>
        void spawned.push({
          entry: options.entry,
          force: options.force,
          token: options.environment?.AIP_WEB_TOKEN,
        }),
    });
    try {
      const started = await controller.start({});
      const token = new URL(started.status.url ?? '').searchParams.get('token') ?? '';
      const base = `http://127.0.0.1:${port}`;
      const response = await post(base, '/api/system/web/restart', token);
      expect(response.status).toBe(202);
      await until(
        'the panel to come back',
        async () => {
          try {
            const view = await fetch(`${base}/api/system`, { headers: { 'x-aip-token': token } });
            return view.status === 200 && (await view.json()) !== null;
          } catch {
            return false;
          }
        },
        5000,
      );
      expect(controller.status()).toMatchObject({ running: true, port });
      expect(controller.status().url).toContain(`token=${token}`);
      const view = (await (
        await fetch(`${base}/api/system`, { headers: { 'x-aip-token': token } })
      ).json()) as ReturnType<typeof systemView>;
      expect(view.web.servedBy).toBe('daemon');
      expect(view.daemon.pid).not.toBeNull();

      const daemon = await post(base, '/api/system/daemon/restart', token, { force: true });
      expect(daemon.status).toBe(202);
      await until('the helper to start', () => spawned.length === 1, 2000);
      expect(spawned[0]).toEqual({ entry: ['node', 'aip.js'], force: true, token });
    } finally {
      await controller.close();
    }
  });

  it('does not pass a token to the helper when web.auth is none', async () => {
    h = await harness(MANUAL_CONFIG);
    const config = mkdtempSync(join(tmpdir(), 'aip-system-config-'));
    mkdirSync(join(config, 'aip'));
    const port = await freePort();
    writeFileSync(join(config, 'aip', 'settings.yaml'), `web: { port: ${port}, auth: none }\n`);
    const tokens: (string | undefined)[] = [];
    const controller = createDaemonPanel({
      stateDirectory: h.state,
      socket: h.socket,
      environment: { XDG_CONFIG_HOME: config },
      entry: ['node', 'aip.js'],
      spawnRestart: (options) => void tokens.push(options.environment?.AIP_WEB_TOKEN),
    });
    try {
      await controller.start({});
      const response = await post(`http://127.0.0.1:${port}`, '/api/system/daemon/restart', '');
      expect(response.status).toBe(202);
      await until('the helper to start', () => tokens.length === 1, 2000);
      expect(tokens[0]).toBeUndefined();
    } finally {
      await controller.close();
    }
  });
});
