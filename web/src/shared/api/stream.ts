import type {
  BackgroundProcessView,
  NetworkStatus,
  DaemonMismatch,
  GlobalQueueView,
  QueueView,
  RepositoryView,
  RunView,
  TagView,
} from './types.ts';

export type Connection = 'live' | 'reconnecting' | 'polling';

/** A WebSocket as the panel uses it; tests put their own in its place. */
export interface SocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onclose: (() => void) | null;
  send(text: string): void;
  close(): void;
}

export type SocketFactory = (path: string) => SocketLike;

export const browserSocket: SocketFactory = (path) => {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(`${scheme}//${location.host}${path}`) as SocketLike;
};

export type StreamEvent =
  | {
      event: 'snapshot';
      runs: RunView[];
      queues?: QueueView[];
      globalQueue?: GlobalQueueView;
      repositories?: RepositoryView[];
      tags?: TagView[];
      daemon?: DaemonMismatch;
    }
  | { event: 'daemon'; daemon: DaemonMismatch }
  | { event: 'repositories'; repositories: RepositoryView[] }
  | { event: 'tags'; repository?: string; tags: TagView[] }
  | { event: 'run'; run: RunView }
  | { event: 'queue'; queue: QueueView }
  /** The global queue; null once the daemon is back in the project mode. */
  | { event: 'globalQueue'; globalQueue: GlobalQueueView | null }
  | { event: 'processes'; processes?: BackgroundProcessView[]; error?: string }
  | { event: 'network'; network: NetworkStatus };

/**
 * An event of the stream as it is read: the ones above, `observers` (the settings changed in
 * another tab) and whatever a newer daemon may send, which is ignored.
 */
export type ReadEvent =
  StreamEvent | { event: 'observers'; observers?: unknown } | { event: string };

const STREAM_EVENTS = new Set([
  'snapshot',
  'daemon',
  'repositories',
  'tags',
  'run',
  'queue',
  'globalQueue',
  'processes',
  'network',
]);

export function isStreamEvent(event: ReadEvent): event is StreamEvent {
  return STREAM_EVENTS.has(event.event);
}

/** The event of a message; `null` when the message is not an object. */
export function parseMessage(data: string): ReadEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  return typeof raw === 'object' && raw !== null ? (raw as ReadEvent) : null;
}

const POLL_MS = 3000;
/** After this long without the stream, fall back to polling the API. */
const POLL_AFTER_MS = 4000;

/** Polling of the API while the stream is down. */
export interface Fallback {
  start(): void;
  stop(): void;
}

export function createFallback(
  poll: () => Promise<void>,
  onPolling: () => void,
  isClosed: () => boolean,
): Fallback {
  let poller: ReturnType<typeof setInterval> | null = null;
  let fallback: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (poller) clearInterval(poller);
    if (fallback) clearTimeout(fallback);
    poller = null;
    fallback = null;
  };
  const start = () => {
    if (poller || fallback) return;
    fallback = setTimeout(() => {
      fallback = null;
      if (isClosed()) return;
      onPolling();
      void poll();
      poller = setInterval(() => void poll(), POLL_MS);
    }, POLL_AFTER_MS);
  };
  return { start, stop };
}

export interface StreamHandlers {
  /** The connection works: it opened or sent a message. */
  live: () => void;
  /** The connection came up: once per connection, before its first event. */
  opened: () => void;
  event: (event: ReadEvent) => void;
  /** The connection broke. */
  broken: () => void;
}

/** The address of the live connection of the panel. */
export const LIVE_PATH = '/api/ws';
/** A broken connection is opened again after this long. */
export const RECONNECT_MS = 2000;

export interface LiveConnection {
  /** Sends a message; false while the connection is down. */
  send(message: object): boolean;
  close(): void;
}

/**
 * Keeps a connection open: a broken one is opened again, and the fallback polling runs while it
 * is down for long.
 */
export function connectLive(
  open: SocketFactory,
  fallback: Fallback,
  handlers: StreamHandlers,
): LiveConnection {
  let socket: SocketLike | null = null;
  let up = false;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const works = () => {
    fallback.stop();
    handlers.live();
    if (up) return;
    up = true;
    handlers.opened();
  };
  const start = () => {
    const current = open(LIVE_PATH);
    socket = current;
    current.onopen = works;
    current.onmessage = (message) => {
      const event = parseMessage(message.data);
      if (event === null) return;
      works();
      handlers.event(event);
    };
    current.onclose = () => {
      if (closed || socket !== current) return;
      up = false;
      handlers.broken();
      fallback.start();
      retry = setTimeout(start, RECONNECT_MS);
    };
  };
  start();
  return {
    send(message) {
      if (!up || socket === null) return false;
      socket.send(JSON.stringify(message));
      return true;
    },
    close() {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    },
  };
}
