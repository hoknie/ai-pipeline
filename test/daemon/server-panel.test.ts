import { mkdtempSync, realpathSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { defaultServer, defaultWeb } from '../../src/feature/swarm-config/types/index.ts';
import { createDaemonPanel, type DaemonPanelController } from '../../src/presentation/web/index.ts';
import { parseListen } from '../../src/presentation/web/panel/daemon-panel.ts';

let panel: DaemonPanelController | null = null;

afterEach(async () => {
  await panel?.close();
  panel = null;
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

describe('panel of the daemon in server mode', () => {
  it('parses server.listen', () => {
    expect(parseListen('0.0.0.0:7341')).toEqual({ host: '0.0.0.0', port: 7341 });
    expect(parseListen('[::1]:80')).toEqual({ host: '::1', port: 80 });
  });

  it('listens on server.listen, shows public_url and warns about AIP_WEB_TOKEN', async () => {
    const port = await freePort();
    const logs: string[] = [];
    const state = realpathSync(mkdtempSync(join(tmpdir(), 'aip-server-panel-')));
    panel = createDaemonPanel({
      stateDirectory: state,
      socket: join(state, 'none.sock'),
      environment: { AIP_WEB_TOKEN: 'abcdefghijklmnop1234' },
      readSettings: () => defaultWeb(),
      readServer: () => ({
        ...defaultServer(),
        enabled: true,
        listen: `127.0.0.1:${port}`,
        publicUrl: 'https://aip.example.com',
      }),
      log: (line) => logs.push(line),
    });
    const started = await panel.autostart();
    expect(started?.url).toBe('https://aip.example.com');
    expect(panel.status()).toMatchObject({ running: true, host: '127.0.0.1', port });
    expect(logs.some((line) => line.includes('AIP_WEB_TOKEN is ignored'))).toBe(true);
    const answer = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      headers: { host: 'aip.example.com' },
    }).catch(() => null);
    // fetch cannot set Host; the panel refuses the loopback host of this request
    expect(answer?.status).toBe(403);
  });
});
