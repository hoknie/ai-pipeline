import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { PanelControl } from '../../src/daemon/index.ts';
import { createDaemonPanel, type DaemonPanelController } from '../../src/cli/web/daemon-panel.ts';
import { runStandbyPanel, type StandbyEnd } from '../../src/cli/web/standby.ts';
import { panelStatePath, readPanelState } from '../../src/cli/web/state.ts';
import type { systemView } from '../../src/cli/web/system.ts';
import { MANUAL_CONFIG, harness, until, type Harness } from '../daemon/harness.ts';

const TOKEN = 'standby-token-0123456789';

let h: Harness | null = null;
let controller: DaemonPanelController | null = null;

afterEach(async () => {
  await controller?.close();
  await h?.close();
  controller = null;
  h = null;
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function system(base: string, token: string): Promise<ReturnType<typeof systemView> | null> {
  try {
    const response = await fetch(`${base}/api/system`, { headers: { 'x-aip-token': token } });
    return response.status === 200
      ? ((await response.json()) as ReturnType<typeof systemView>)
      : null;
  } catch {
    return null;
  }
}

/** A daemon with a panel on `port`, stopped, so the stand-in can take the port. */
async function stoppedDaemon(port: number): Promise<{ config: string }> {
  const config = mkdtempSync(join(tmpdir(), 'aip-standby-config-'));
  mkdirSync(join(config, 'aip'));
  writeFileSync(join(config, 'aip', 'settings.yaml'), `web: { port: ${port} }\n`);
  // The panel needs the socket of the harness, known only once it runs.
  const panel: PanelControl = {
    status: () => controller!.status(),
    start: (options) => controller!.start(options),
    stop: () => controller!.stop(),
  };
  h = await harness(MANUAL_CONFIG, {}, { panel });
  controller = createDaemonPanel({
    stateDirectory: h.state,
    socket: h.socket,
    environment: { XDG_CONFIG_HOME: config },
  });
  await h.running.close();
  return { config };
}

describe('runStandbyPanel', () => {
  it('serves the panel while the daemon is stopped and hands it back once a daemon runs', async () => {
    const port = await freePort();
    const { config } = await stoppedDaemon(port);
    const lines: string[] = [];
    const urls: string[] = [];
    let ended: StandbyEnd | null = null;
    const standby = runStandbyPanel({
      socket: h!.socket,
      stateDirectory: h!.state,
      entry: ['node', 'aip.js'],
      environment: { XDG_CONFIG_HOME: config, AIP_WEB_TOKEN: TOKEN },
      cwd: h!.repo,
      pid: process.pid,
      log: (line) => void lines.push(line),
      stop: new Promise(() => undefined),
      onListening: (url) => void urls.push(url),
      pollMs: 50,
    }).then((end) => {
      ended = end;
    });
    const base = `http://127.0.0.1:${port}`;
    await until('the stand-in to listen', () => urls.length === 1, 5000);
    expect(urls[0]).toContain(`token=${TOKEN}`);
    expect(readPanelState(h!.state)).toMatchObject({ pid: process.pid, port, standby: true });
    const view = await system(base, TOKEN);
    expect(view?.daemon.running).toBe(false);
    expect(view?.web.servedBy).toBe('standby');
    // Nothing but Start runs on the stand-in: the daemon is stopped.
    for (const path of ['/api/system/web/restart', '/api/system/daemon/restart']) {
      const refused = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-aip-token': TOKEN },
        body: '{}',
      });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ code: 'daemon_stopped' });
    }

    // A daemon started from elsewhere takes the panel back with the same token.
    await h!.restart();
    await until('the stand-in to hand the panel over', () => ended !== null, 10_000);
    await standby;
    expect(ended).toBe('handed_over');
    expect(controller!.status()).toMatchObject({ running: true, port });
    const back = await system(base, TOKEN);
    expect(back?.daemon.running).toBe(true);
    expect(back?.web.servedBy).toBe('daemon');
    expect(readPanelState(h!.state)?.standby).toBeUndefined();
  });

  it('goes away on stop without starting the daemon', async () => {
    const port = await freePort();
    const { config } = await stoppedDaemon(port);
    let stop: () => void = () => undefined;
    const urls: string[] = [];
    const standby = runStandbyPanel({
      socket: h!.socket,
      stateDirectory: h!.state,
      entry: ['node', 'aip.js'],
      environment: { XDG_CONFIG_HOME: config, AIP_WEB_TOKEN: TOKEN },
      cwd: h!.repo,
      pid: process.pid,
      log: () => undefined,
      stop: new Promise((resolve) => {
        stop = resolve;
      }),
      onListening: (url) => void urls.push(url),
      pollMs: 50,
    });
    await until('the stand-in to listen', () => urls.length === 1, 5000);
    stop();
    expect(await standby).toBe('stopped');
    expect(existsSync(panelStatePath(h!.state))).toBe(false);
    expect(await system(`http://127.0.0.1:${port}`, TOKEN)).toBeNull();
    expect(controller!.status().running).toBe(false);
  });
});
