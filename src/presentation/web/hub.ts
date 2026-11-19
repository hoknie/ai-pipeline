import type { IncomingMessage, ServerResponse } from 'node:http';

import { subscribe } from '../ipc/client/index.ts';
import { streamEventSchema, type DaemonCheck } from '../ipc/contract/index.ts';

import { RECHECK_MS } from './options.ts';

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
  private readonly clients = new Set<ServerResponse>();
  /** The live connections of the panel: each takes a message as text. */
  private readonly sinks = new Set<(text: string) => void>();
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
  ) {
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

  private broadcast(event: unknown): void {
    const text = JSON.stringify(event);
    const frame = `data: ${text}\n\n`;
    for (const client of this.clients) client.write(frame);
    for (const send of this.sinks) send(text);
  }

  /** A live connection: the snapshot and the last processes now, then every event. */
  join(send: (text: string) => void): () => void {
    this.sinks.add(send);
    if (this.ready) {
      send(JSON.stringify(this.snapshot()));
      if (this.processes) send(JSON.stringify({ ...this.processes, seq: this.seq }));
    }
    return () => this.sinks.delete(send);
  }

  attach(incoming: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write('retry: 2000\n\n');
    this.clients.add(response);
    if (this.ready) {
      response.write(`data: ${JSON.stringify(this.snapshot())}\n\n`);
      if (this.processes) {
        response.write(`data: ${JSON.stringify({ ...this.processes, seq: this.seq })}\n\n`);
      }
    }
    const beat = setInterval(() => response.write(': ping\n\n'), 15_000);
    incoming.on('close', () => {
      clearInterval(beat);
      this.clients.delete(response);
    });
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.recheck);
    this.abort.abort();
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}
