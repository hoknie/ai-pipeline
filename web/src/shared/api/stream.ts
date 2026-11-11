import type {
  BackgroundProcessView,
  NetworkStatus,
  DaemonMismatch,
  QueueView,
  RepositoryView,
  RunView,
  TagView,
} from './types.ts';

export type Connection = 'live' | 'reconnecting' | 'polling';

export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export const browserEventSource: EventSourceFactory = (url) => new EventSource(url);

export type StreamEvent =
  | {
      event: 'snapshot';
      runs: RunView[];
      queues?: QueueView[];
      repositories?: RepositoryView[];
      tags?: TagView[];
      daemon?: DaemonMismatch;
    }
  | { event: 'daemon'; daemon: DaemonMismatch }
  | { event: 'repositories'; repositories: RepositoryView[] }
  | { event: 'tags'; repository?: string; tags: TagView[] }
  | { event: 'run'; run: RunView }
  | { event: 'queue'; queue: QueueView }
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
  /** The stream works: an open connection or a message. */
  live: () => void;
  event: (event: ReadEvent) => void;
  /** The stream broke. */
  broken: () => void;
}

/** Wires a stream to the handlers; the fallback polling stops while the stream speaks. */
export function listen(
  source: EventSourceLike,
  fallback: Fallback,
  handlers: StreamHandlers,
): void {
  source.onopen = () => {
    fallback.stop();
    handlers.live();
  };
  source.onmessage = (message) => {
    const event = parseMessage(message.data);
    if (event === null) return;
    fallback.stop();
    handlers.live();
    handlers.event(event);
  };
  source.onerror = () => {
    handlers.broken();
    fallback.start();
  };
}
