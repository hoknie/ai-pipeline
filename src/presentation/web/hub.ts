import type { IncomingMessage, ServerResponse } from 'node:http';

import { subscribe } from '../ipc/client/index.ts';
import { streamEventSchema, type DaemonCheck } from '../ipc/contract/index.ts';

import { RECHECK_MS } from './options.ts';
import { eventFor, type Allowed } from './visible.ts';

/** How long the readable projects of a subscriber are kept before they are asked for again. */
export const ACCESS_CACHE_MS = 10_000;

/** The paths of the projects a user reads; `null`: all of them. */
export type ReadableProjects = (actor: string) => Promise<string[] | null>;

/** One connection that gets the events: a live socket or an event stream. */
interface Subscriber {
  write(text: string): void;
  /** The user of server mode; undefined for the local panel, which sees everything. */
  actor: string | undefined;
  /** The projects it reads; `undefined` until they are known. */
  allowed: Allowed | undefined;
  loadedAt: number;
  loading: Promise<void> | null;
}

/** What the subscriptions of the panel react to: a run changed, a log grew. */
export type HubSignal =
  { event: 'run'; runId: string } | { event: 'log'; runId: string; group: string; attempt: number };

/** Fan-out of the daemon event stream; keeps the latest state of every run. */
export class Hub {
  private readonly socket: string;
  private runs = new Map<string, unknown>();
  private queues = new Map<string, unknown>();
  /** The global queue of the global mode; null in the project mode. */
  private globalQueue: unknown = null;
  private repositories: unknown[] = [];
  private tags: unknown[] = [];
  /** The last `processes` event of the daemon, without `seq`; null until it sends one. */
  private processes: { event: 'processes'; processes?: unknown[]; error?: string } | null = null;
  private seq = 0;
  private ready = false;
  private stopped = false;
  private readonly abort = new AbortController();
  private readonly subscribers = new Set<Subscriber>();
  /** The event streams to close when the hub stops. */
  private readonly ends = new Set<{ response: ServerResponse; done: () => void }>();
  private readonly readable: ReadableProjects | undefined;
  private readonly onSignal: (signal: HubSignal) => void;
  private readonly ensure: () => Promise<DaemonCheck>;
  /** Build mismatch with the daemon, as the panel shows it; null when the builds match. */
  private daemon: DaemonCheck['mismatch'] = null;
  private checking: Promise<void> | null = null;
  private readonly recheck: ReturnType<typeof setInterval>;

  constructor(
    socket: string,
    ensure: () => Promise<DaemonCheck>,
    onSignal: (signal: HubSignal) => void = () => undefined,
    readable?: ReadableProjects,
  ) {
    this.readable = readable;
    this.socket = socket;
    this.ensure = ensure;
    this.onSignal = onSignal;
    this.recheck = setInterval(() => {
      if (this.daemon?.outdated === 'daemon') void this.check();
    }, RECHECK_MS);
    this.recheck.unref();
    void this.connect();
  }

  private check(): Promise<void> {
    this.checking ??= this.ensure()
      .then(
        (result) => {
          if (JSON.stringify(result.mismatch) === JSON.stringify(this.daemon)) return;
          this.daemon = result.mismatch;
          this.broadcast({ event: 'daemon', daemon: this.daemon });
        },
        () => undefined, // the daemon is not reachable; the connection below retries
      )
      .finally(() => {
        this.checking = null;
      });
    return this.checking;
  }

  private async connect(): Promise<void> {
    while (!this.stopped) {
      await this.check();
      if (this.stopped) break;
      try {
        await subscribe(this.socket, (line) => this.onLine(line), this.abort.signal, {
          logs: true,
        });
      } catch {
        // the daemon is not reachable yet; retry below
      }
      this.ready = false;
      if (!this.stopped)
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 1000);
          this.abort.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve(undefined);
            },
            { once: true },
          );
        });
    }
  }

  private onLine(line: string): void {
    let event;
    try {
      event = streamEventSchema.parse(JSON.parse(line));
    } catch {
      return;
    }
    if (event.event === 'log') {
      // Never relayed: the subscriptions read the log and send what is new.
      this.seq = event.seq;
      this.onSignal(event);
    } else if (event.event === 'snapshot') {
      this.tags = event.tags ?? [];
      this.runs = new Map(event.runs.map((run) => [run.id, run]));
      this.queues = new Map((event.queues ?? []).map((queue) => [queue.repository, queue]));
      this.globalQueue = event.globalQueue ?? null;
      this.repositories = event.repositories ?? [];
      this.processes = null;
      this.ready = true;
      this.seq = event.seq;
      this.broadcast(this.snapshot());
    } else if (event.event === 'run') {
      this.runs.set(event.run.id, event.run);
      this.seq = event.seq;
      this.broadcast(event);
      this.onSignal({ event: 'run', runId: event.run.id });
    } else if (event.event === 'repositories') {
      this.repositories = event.repositories;
      this.seq = event.seq;
      this.broadcast(event);
    } else if (event.event === 'queue') {
      this.queues.set(event.queue.repository, event.queue);
      this.seq = event.seq;
      this.broadcast(event);
    } else if (event.event === 'globalQueue') {
      this.globalQueue = event.globalQueue;
      this.seq = event.seq;
      this.broadcast(event);
    } else if (event.event === 'tags') {
      this.tags = event.tags;
      this.seq = event.seq;
      this.broadcast(event);
    } else if (event.event === 'observers') {
      // Not kept: the snapshot has no observers, a new tab reads GET /api/observers.
      this.seq = event.seq;
      this.broadcast(event);
    } else if (event.event === 'network') {
      this.seq = event.seq;
      this.broadcast(event);
    } else if (event.event === 'processes') {
      const { seq, ...rest } = event;
      this.processes = rest;
      this.seq = seq;
      this.broadcast(event);
    }
  }

  private snapshot(): unknown {
    return {
      event: 'snapshot',
      seq: this.seq,
      runs: [...this.runs.values()],
      queues: [...this.queues.values()],
      ...(this.globalQueue === null ? {} : { globalQueue: this.globalQueue }),
      repositories: this.repositories,
      tags: this.tags,
      daemon: this.daemon,
    };
  }

  /** Asks which projects the subscriber reads; no answer yet means none, a later failure keeps the last. */
  private refresh(subscriber: Subscriber): Promise<void> {
    const { actor } = subscriber;
    if (actor === undefined || this.readable === undefined) {
      subscriber.allowed = null;
      return Promise.resolve();
    }
    subscriber.loading ??= this.readable(actor)
      .then(
        (paths) => {
          subscriber.allowed = paths === null ? null : new Set(paths);
        },
        () => {
          subscriber.allowed ??= new Set();
        },
      )
      .finally(() => {
        subscriber.loadedAt = Date.now();
        subscriber.loading = null;
      });
    return subscriber.loading;
  }

  /** Sends an event to a subscriber, without what belongs to the projects it does not read. */
  private deliver(subscriber: Subscriber, event: unknown, text: string): void {
    const { allowed } = subscriber;
    if (allowed === undefined) return; // its snapshot follows as soon as its projects are known
    if (subscriber.actor !== undefined && Date.now() - subscriber.loadedAt > ACCESS_CACHE_MS) {
      void this.refresh(subscriber);
    }
    if (allowed === null) return subscriber.write(text);
    const visible = eventFor(event as Record<string, unknown>, allowed);
    if (visible !== null) subscriber.write(JSON.stringify(visible));
  }

  private broadcast(event: unknown): void {
    const text = JSON.stringify(event);
    for (const subscriber of this.subscribers) this.deliver(subscriber, event, text);
  }

  /** The snapshot and the last processes: what a new connection gets first. */
  private greet(subscriber: Subscriber): void {
    if (!this.ready) return;
    const snapshot = this.snapshot();
    this.deliver(subscriber, snapshot, JSON.stringify(snapshot));
    if (this.processes) {
      const processes = { ...this.processes, seq: this.seq };
      this.deliver(subscriber, processes, JSON.stringify(processes));
    }
  }

  private add(write: (text: string) => void, actor: string | undefined): () => void {
    const subscriber: Subscriber = {
      write,
      actor,
      allowed: undefined,
      loadedAt: 0,
      loading: null,
    };
    this.subscribers.add(subscriber);
    void this.refresh(subscriber).then(() => this.greet(subscriber));
    return () => this.subscribers.delete(subscriber);
  }

  /** A live connection: the snapshot and the last processes now, then every event. */
  join(send: (text: string) => void, actor?: string): () => void {
    return this.add(send, actor);
  }

  attach(incoming: IncomingMessage, response: ServerResponse, actor?: string): void {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write('retry: 2000\n\n');
    const leave = this.add((text) => response.write(`data: ${text}\n\n`), actor);
    const beat = setInterval(() => response.write(': ping\n\n'), 15_000);
    const end = {
      response,
      done: (): void => {
        clearInterval(beat);
        leave();
        this.ends.delete(end);
      },
    };
    incoming.on('close', end.done);
    this.ends.add(end);
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.recheck);
    this.abort.abort();
    for (const { response, done } of this.ends) {
      done();
      response.end();
    }
    this.ends.clear();
  }
}
