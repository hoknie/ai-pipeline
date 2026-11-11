import {
  interfaceUp,
  probeHttp,
  probeTcp,
  type ProbeResult,
} from '../../../platform/network/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import type { NetworkSettings } from '../../swarm-config/types/index.ts';
import type { NetworkChangedPort } from '../ports/index.ts';
import {
  initialState,
  nextCheckDelay,
  nextState,
  probeProxy,
  redactProxy,
  shownProxy,
  snapshotOf,
  stateChanged,
  type NetworkCheck,
  type NetworkSnapshot,
  type NetworkState,
  type NetworkStatus,
} from '../types/index.ts';

export interface NetworkProbes {
  interfaceUp(name: string): boolean;
  tcp(host: string, port: number, timeoutMs: number, proxy: string | null): Promise<ProbeResult>;
  http(url: string, timeoutMs: number, proxy: string | null): Promise<ProbeResult>;
}

const realProbes: NetworkProbes = {
  interfaceUp,
  tcp: probeTcp,
  http: probeHttp,
};

export interface NetworkMonitorDependencies {
  config: ConfigService;
  now: () => number;
  changed: NetworkChangedPort;
  probes?: NetworkProbes;
  environment?: NodeJS.ProcessEnv;
}

function splitTarget(target: string): { host: string; port: number } {
  const at = target.lastIndexOf(':');
  return { host: target.slice(0, at).replace(/^\[|\]$/g, ''), port: Number(target.slice(at + 1)) };
}

/** Checks the network on a timer and holds its state; the settings are reread on every check. */
export class NetworkMonitor {
  private readonly config: ConfigService;
  private readonly now: () => number;
  private readonly port: NetworkChangedPort;
  private readonly probes: NetworkProbes;
  private readonly environment: NodeJS.ProcessEnv;
  private current: NetworkState;
  private lastSettings: NetworkSettings | null = null;
  private inflight: Promise<NetworkSnapshot> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;

  constructor(dependencies: NetworkMonitorDependencies) {
    this.config = dependencies.config;
    this.now = dependencies.now;
    this.port = dependencies.changed;
    this.probes = dependencies.probes ?? realProbes;
    this.environment = dependencies.environment ?? {};
    this.current = initialState(false, this.now());
  }

  /** The state of the network; `up` before the first check when the check is enabled. */
  state(): NetworkState {
    return this.current;
  }

  snapshot(): NetworkSnapshot {
    return snapshotOf(this.current);
  }

  /** The state with the proxy of the check without login and password. */
  status(): NetworkStatus {
    const proxy =
      this.lastSettings === null ? null : shownProxy(this.lastSettings.proxy, this.environment);
    return { ...this.current, proxy: proxy === null ? null : redactProxy(proxy) };
  }

  /** The proxy of the agents as the settings say now. */
  proxy(): string | null {
    const settings = this.readSettings();
    return settings === null ? null : settings.proxy;
  }

  /** Starts the checks: the first one at once, the next ones on the interval. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const settings = this.readSettings();
    this.current = initialState(settings?.enabled ?? false, this.now());
    void this.checkNow();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Checks the network unless the last check is not older than `maxAgeMs`. */
  async ensureFresh(maxAgeMs: number): Promise<NetworkSnapshot> {
    const settings = this.readSettings();
    if (settings === null || !settings.enabled) return this.checkNow();
    const checkedAt = this.current.checkedAt;
    if (checkedAt !== null && this.now() - checkedAt <= maxAgeMs) return this.snapshot();
    return this.checkNow();
  }

  /** Checks the network now; concurrent calls wait for one check. */
  checkNow(): Promise<NetworkSnapshot> {
    this.inflight ??= this.check().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private readSettings(): NetworkSettings | null {
    const settings = this.config.networkSettings();
    if (typeof settings === 'string') {
      this.lastSettings = null;
      return null;
    }
    this.lastSettings = settings;
    return settings;
  }

  private async check(): Promise<NetworkSnapshot> {
    const settings = this.readSettings();
    let result: NetworkCheck;
    if (settings === null || !settings.enabled) {
      result = { kind: 'off' };
    } else {
      try {
        result = await this.probe(settings);
      } catch (error) {
        result = { kind: 'fail', problem: error instanceof Error ? error.message : String(error) };
      }
    }
    const before = this.current;
    this.current = nextState(before, result, this.now());
    if (stateChanged(before, this.current)) this.port.changed(this.current);
    this.schedule(settings);
    return this.snapshot();
  }

  private schedule(settings: NetworkSettings | null): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped) return;
    const delay = nextCheckDelay(settings ?? { enabled: false, interval: 30 }, this.current);
    this.timer = setTimeout(() => void this.checkNow(), delay);
    this.timer.unref();
  }

  /** The first problem in the order of the settings: interfaces, then targets. */
  private async probe(settings: NetworkSettings): Promise<NetworkCheck> {
    for (const name of settings.interfaces) {
      if (!this.probes.interfaceUp(name))
        return { kind: 'fail', problem: `interface ${name} is down` };
    }
    const timeoutMs = settings.timeout * 1000;
    const results = await Promise.all(
      settings.targets.map((target) => {
        if (/^https?:\/\//i.test(target))
          return this.probes.http(
            target,
            timeoutMs,
            probeProxy(target, settings.proxy, this.environment),
          );
        const { host, port } = splitTarget(target);
        return this.probes.tcp(
          host,
          port,
          timeoutMs,
          probeProxy(target, settings.proxy, this.environment),
        );
      }),
    );
    for (const result of results) if (!result.ok) return { kind: 'fail', problem: result.problem };
    return { kind: 'ok' };
  }
}
