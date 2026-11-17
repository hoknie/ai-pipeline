/** The network check of the daemon; read from the global settings.yaml only. */
export interface NetworkSettings {
  /** The daemon checks the network and holds agents while it is down. */
  enabled: boolean;
  /** `host:port` (a TCP connection) or an `http(s)://` URL (a GET request). */
  targets: string[];
  /** Interfaces that must exist and have a non-loopback address, such as `wt0` of NetBird. */
  interfaces: string[];
  /** An `http(s)://` proxy: probes go through it and agents get it as `HTTPS_PROXY`. */
  proxy: string | null;
  /** Seconds between two checks. */
  interval: number;
  /** Seconds a probe may take. */
  timeout: number;
}

export const ATTACHMENT_STORAGES = ['local', 's3'] as const;

export type AttachmentStorage = (typeof ATTACHMENT_STORAGES)[number];

/** Storage for new task attachments; read from the shared settings.yaml only. */
export interface AttachmentSettings {
  storage: AttachmentStorage;
  s3: {
    bucket: string | null;
    region: string;
    endpoint: string | null;
    prefix: string;
    pathStyle: boolean;
  };
}

export function defaultAttachments(): AttachmentSettings {
  return {
    storage: 'local',
    s3: {
      bucket: null,
      region: 'us-east-1',
      endpoint: null,
      prefix: 'aip/attachments/',
      pathStyle: false,
    },
  };
}

/** The usage statistics of the daemon; read from the global settings.yaml only. */
export interface StatsSettings {
  /** The daemon keeps the usage journal. */
  enabled: boolean;
  /** Project paths whose usage is not recorded and not reported. */
  exclude: string[];
}

export function defaultStats(): StatsSettings {
  return { enabled: true, exclude: [] };
}

export const QUEUE_SCOPES = ['project', 'global'] as const;
export type QueueScopeName = (typeof QUEUE_SCOPES)[number];
export const QUEUE_MAX_RANGE = [1, 32] as const;

/** A named quota of the agent attempts that work at once on the machine. */
export interface QueuePool {
  name: string;
  /** The most attempts of the pool working at once; the pool lends and borrows no places. */
  max: number;
  /** `claude`, `agy`, `opencode` (no explicit model) or `opencode:provider/model` (a trailing `*` for a prefix). */
  members: string[];
}

/** The quota of the attempts no pool takes. */
export interface DefaultQueuePool {
  max: number;
}

/** The mode of the task queue and the specialist limits of the machine; the global settings.yaml only. */
export interface QueueSettings {
  /** `project`: a queue per project; `global`: one queue for all projects. */
  scope: QueueScopeName;
  /** The most agent attempts working at once on the machine in both modes. */
  max: number;
  /** Quotas of the attempts by runtime and model; empty: no quotas. */
  pools: QueuePool[];
  /** The quota of the attempts outside every pool; set exactly when `pools` is not empty. */
  defaultPool: DefaultQueuePool | null;
}

export function defaultQueue(): QueueSettings {
  return { scope: 'project', max: 5, pools: [], defaultPool: null };
}

export const DEFAULT_NETWORK_TARGET = 'https://api.anthropic.com';

export function defaultNetwork(): NetworkSettings {
  return {
    enabled: false,
    targets: [DEFAULT_NETWORK_TARGET],
    interfaces: [],
    proxy: null,
    interval: 30,
    timeout: 5,
  };
}

/** The proxy URL without login and password; text that is not a URL is returned as it is. */
export function redactProxy(proxy: string): string {
  try {
    const url = new URL(proxy);
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return proxy;
  }
}
