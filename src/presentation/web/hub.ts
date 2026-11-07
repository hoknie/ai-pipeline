import type { IncomingMessage, ServerResponse } from 'node:http';

import { subscribe } from '../ipc/client/index.ts';
import { streamEventSchema, type DaemonCheck } from '../ipc/contract/index.ts';

import { RECHECK_MS } from './options.ts';

/** Fan-out of the daemon event stream; keeps the latest state of every run. */
export class Hub {
  private readonly socket: string;
  private runs = new Map<string, unknown>();
  private queues = new Map<string, unknown>();
  private repositories: unknown[] = [];
  private tags: unknown[] = [];
  /** The last `processes` event of the daemon, without `seq`; null until it sends one. */
  private processes: { event: 'processes'; processes?: unknown[]; error?: string } | null = null;
  private seq = 0;
  private ready = false;
  private stopped = false;
  private readonly abort = new AbortController();
  private readonly clients = new Set<ServerResponse>();
  private readonly ensure: () => Promise<DaemonCheck>;
  /** Build mismatch with the daemon, as the panel shows it; null when the builds match. */
  private daemon: DaemonCheck['mismatch'] = null;
  private checking: Promise<void> | null = null;
  private readonly recheck: ReturnType<typeof setInterval>;

  constructor(socket: string, ensure: () => Promise<DaemonCheck>) {
    this.socket = socket;
    this.ensure = ensure;
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
        await subscribe(this.socket, (line) => this.onLine(line), this.abort.signal);
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
    if (event.event === 'snapshot') {
      this.tags = event.tags ?? [];
      this.runs = new Map(event.runs.map((run) => [run.id, run]));
      this.queues = new Map((event.queues ?? []).map((queue) => [queue.repository, queue]));
      this.repositories = event.repositories ?? [];
      this.processes = null;
      this.ready = true;
      this.seq = event.seq;
      this.broadcast(this.snapshot());
    } else if (event.event === 'run') {
      this.runs.set(event.run.id, event.run);
      this.seq = event.seq;
      this.broadcast(event);
    } else if (event.event === 'repositories') {
      this.repositories = event.repositories;
      this.seq = event.seq;
      this.broadcast(event);
    } else if (event.event === 'queue') {
      this.queues.set(event.queue.repository, event.queue);
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
      repositories: this.repositories,
      tags: this.tags,
      daemon: this.daemon,
    };
  }

  private broadcast(event: unknown): void {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) client.write(frame);
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
