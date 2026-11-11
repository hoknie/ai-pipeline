import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NetworkMonitor, type NetworkProbes } from '../../../src/feature/network/services/index.ts';
import type { NetworkState } from '../../../src/feature/network/types/index.ts';
import { ConfigService } from '../../../src/feature/swarm-config/services/index.ts';

let settingsFile = '';
let clock = 0;
const events: NetworkState[] = [];
let failing = new Set<string>();
let probeCalls = 0;

function writeSettings(text: string): void {
  writeFileSync(settingsFile, text);
}

function probes(): NetworkProbes {
  return {
    interfaceUp: (name) => !failing.has(`interface:${name}`),
    tcp: async (host, port) => {
      probeCalls++;
      await Promise.resolve();
      return failing.has(`${host}:${port}`)
        ? { ok: false, problem: `${host}:${port}: refused` }
        : { ok: true };
    },
    http: async (url) => {
      probeCalls++;
      await Promise.resolve();
      return failing.has(url) ? { ok: false, problem: `${url}: HTTP 403` } : { ok: true };
    },
  };
}

const proxiesSeen: (string | null)[] = [];

function monitor(environment: NodeJS.ProcessEnv = {}): NetworkMonitor {
  const config = new ConfigService({
    environment: { XDG_CONFIG_HOME: join(settingsFile, '..', '..') },
  });
  return new NetworkMonitor({
    config,
    now: () => clock,
    changed: { changed: (state) => events.push(state) },
    probes: {
      ...probes(),
      http: async (url, timeoutMs, proxy) => {
        proxiesSeen.push(proxy);
        return probes().http(url, timeoutMs, proxy);
      },
    },
    environment,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  const root = mkdtempSync(join(tmpdir(), 'aip-monitor-'));
  mkdirSync(join(root, 'aip'), { recursive: true });
  settingsFile = join(root, 'aip', 'settings.yaml');
  clock = 1000;
  events.length = 0;
  failing = new Set();
  probeCalls = 0;
  proxiesSeen.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NetworkMonitor', () => {
  it('is off and runs no probes when the check is disabled', async () => {
    writeSettings('max: 2\n');
    const network = monitor();
    network.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(network.state().state).toBe('off');
    expect(probeCalls).toBe(0);
    expect(events).toEqual([]);
  });

  it('starts up, checks at once and on the interval, and reports a change', async () => {
    writeSettings(
      'network: { enabled: true, targets: ["https://a.test", "10.0.0.1:443"], interval: 10 }\n',
    );
    const network = monitor();
    network.start();
    expect(network.state().state).toBe('up');
    await vi.advanceTimersByTimeAsync(0);
    expect(probeCalls).toBe(2);
    expect(network.state().checkedAt).toBe(1000);
    expect(events).toEqual([]);

    failing.add('10.0.0.1:443');
    clock = 11_000;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(network.state()).toMatchObject({
      state: 'down',
      problem: '10.0.0.1:443: refused',
      since: 11_000,
    });
    expect(events).toHaveLength(1);

    // while down the check repeats every 5 seconds, and recovery is reported
    failing.clear();
    clock = 16_000;
    await vi.advanceTimersByTimeAsync(5000);
    expect(network.state().state).toBe('up');
    expect(events.map((event) => event.state)).toEqual(['down', 'up']);
    network.stop();
  });

  it('reports a missing interface before any target', async () => {
    writeSettings('network: { enabled: true, interfaces: [wt0] }\n');
    failing.add('interface:wt0');
    const network = monitor();
    network.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(network.state()).toMatchObject({ state: 'down', problem: 'interface wt0 is down' });
    expect(probeCalls).toBe(0);
    network.stop();
  });

  it('notices a settings change without a restart', async () => {
    writeSettings('max: 2\n');
    const network = monitor();
    network.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(network.state().state).toBe('off');
    writeSettings('network: { enabled: true, interfaces: [wt0] }\n');
    failing.add('interface:wt0');
    clock = 31_000;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(network.state().state).toBe('down');
    expect(events).toHaveLength(1);
    network.stop();
  });

  it('shares one probe between concurrent ensureFresh calls and skips a fresh check', async () => {
    writeSettings('network: { enabled: true, targets: ["https://a.test"] }\n');
    const network = monitor();
    const [first, second] = await Promise.all([network.ensureFresh(0), network.ensureFresh(0)]);
    expect(probeCalls).toBe(1);
    expect(first).toEqual(second);
    clock += 3000;
    await network.ensureFresh(10_000);
    expect(probeCalls).toBe(1);
    clock += 20_000;
    await network.ensureFresh(10_000);
    expect(probeCalls).toBe(2);
  });

  it('calls the port only when the state or the problem changes', async () => {
    writeSettings('network: { enabled: true, targets: ["https://a.test"] }\n');
    const network = monitor();
    failing.add('https://a.test');
    await network.checkNow();
    await network.checkNow();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ state: 'down', problem: 'https://a.test: HTTP 403' });
  });

  it('shows the proxy without credentials', async () => {
    writeSettings('network: { enabled: true, proxy: "http://u:secret@127.0.0.1:3128" }\n');
    const network = monitor();
    await network.checkNow();
    expect(network.status().proxy).toBe('http://127.0.0.1:3128');
    expect(network.proxy()).toBe('http://u:secret@127.0.0.1:3128');
  });

  it('probes through the proxy of the environment when no proxy is set', async () => {
    writeSettings('network: { enabled: true, targets: ["https://a.test"] }\n');
    const network = monitor({ HTTPS_PROXY: 'http://u:secret@10.0.0.5:3128' });
    await network.checkNow();
    expect(proxiesSeen).toEqual(['http://u:secret@10.0.0.5:3128']);
    expect(network.status().proxy).toBe('http://10.0.0.5:3128');
    expect(network.proxy()).toBeNull();
  });

  it('probes directly a target listed in NO_PROXY', async () => {
    writeSettings('network: { enabled: true, targets: ["https://a.test"] }\n');
    const network = monitor({ HTTPS_PROXY: 'http://10.0.0.5:3128', NO_PROXY: '.a.test' });
    await network.checkNow();
    expect(proxiesSeen).toEqual([null]);
  });

  it('prefers the configured proxy to the environment', async () => {
    writeSettings(
      'network: { enabled: true, targets: ["https://a.test"], proxy: "http://127.0.0.1:1" }\n',
    );
    const network = monitor({ HTTPS_PROXY: 'http://10.0.0.5:3128' });
    await network.checkNow();
    expect(proxiesSeen).toEqual(['http://127.0.0.1:1']);
    expect(network.status().proxy).toBe('http://127.0.0.1:1');
  });

  it('treats a broken section as a disabled check', async () => {
    writeSettings('network: { enabled: true, interval: 1 }\n');
    const network = monitor();
    await network.checkNow();
    expect(network.state().state).toBe('off');
  });
});
