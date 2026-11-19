import { findGroup, type RunState } from '../../feature/runs/types/index.ts';

/** The shortest time between two `log` events of one attempt. */
export const LOG_EVENT_MS = 300;

interface AttemptKey {
  run: string;
  group: string;
  seq: number;
}

interface Watched {
  key: AttemptKey;
  sentAt: number;
  timer: NodeJS.Timeout | null;
}

/**
 * The `log` events: the log of an attempt grew or the attempt ended. Only the subscribers that
 * asked for them get them, and nothing is watched while there are none.
 */
export class LogSignals {
  private readonly now: () => number;
  private readonly nextSeq: () => number;
  private readonly subscribers = new Set<(line: string) => void>();
  private readonly attempts = new Map<string, Watched>();

  constructor(now: () => number, nextSeq: () => number) {
    this.now = now;
    this.nextSeq = nextSeq;
  }

  /** Adds a subscriber; returns the function that removes it. */
  add(send: (line: string) => void): () => void {
    this.subscribers.add(send);
    return () => {
      this.subscribers.delete(send);
      if (this.subscribers.size > 0) return;
      for (const watched of this.attempts.values()) if (watched.timer) clearTimeout(watched.timer);
      this.attempts.clear();
    };
  }

  /** New lines of the log are on disk: one event now, or one at the end of the quiet time. */
  grew(key: AttemptKey): void {
    if (this.subscribers.size === 0) return;
    const id = `${key.run}/${key.group}/${key.seq}`;
    const watched = this.attempts.get(id) ?? { key, sentAt: -Infinity, timer: null };
    this.attempts.set(id, watched);
    if (watched.timer) return;
    const wait = watched.sentAt + LOG_EVENT_MS - this.now();
    if (wait <= 0) {
      this.send(watched);
      return;
    }
    watched.timer = setTimeout(() => {
      watched.timer = null;
      this.send(watched);
    }, wait);
    watched.timer.unref();
  }

  /** A run changed: every watched attempt of it that no longer runs gets its last event at once. */
  runChanged(state: RunState): void {
    for (const [id, watched] of this.attempts) {
      if (watched.key.run !== state.run.id) continue;
      const attempt = findGroup(state, watched.key.group)?.attempts.find(
        (candidate) => candidate.seq === watched.key.seq,
      );
      if (attempt?.status === 'running') continue;
      if (watched.timer) clearTimeout(watched.timer);
      this.attempts.delete(id);
      this.send(watched);
    }
  }

  private send(watched: Watched): void {
    watched.sentAt = this.now();
    const { run, group, seq } = watched.key;
    const line = JSON.stringify({
      event: 'log',
      seq: this.nextSeq(),
      runId: run,
      group,
      attempt: seq,
    });
    for (const send of this.subscribers) send(line);
  }
}
