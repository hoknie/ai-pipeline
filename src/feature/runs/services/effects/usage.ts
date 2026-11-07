import type { Usage } from '../../../agents/types/index.ts';
import type { RunState } from '../../types/index.ts';

import { keyOf, type AttemptKey, type EffectContext } from './context.ts';

interface UsageBuffer {
  state: RunState;
  pending: Map<string, { group: string; seq: number; usage: Usage }>;
  timer: NodeJS.Timeout | null;
}

/** The live usage of running attempts reaches the state of their run at most once per interval. */
export class UsageBuffers {
  private readonly context: EffectContext;
  private readonly intervalMs: () => number;
  /** Live usage of running attempts waiting for the next flush, by run. */
  private readonly buffers = new Map<string, UsageBuffer>();

  constructor(context: EffectContext, intervalMs: () => number) {
    this.context = context;
    this.intervalMs = intervalMs;
  }

  report(state: RunState, key: AttemptKey, usage: Usage): void {
    if (this.context.stopping) return;
    let buffer = this.buffers.get(key.run);
    if (!buffer) {
      buffer = { state, pending: new Map(), timer: null };
      this.buffers.set(key.run, buffer);
    }
    buffer.pending.set(keyOf(key), { group: key.group, seq: key.seq, usage });
    // Leading edge: with no timer running the value goes at once; the timer holds back the rest.
    if (buffer.timer === null) this.flush(key.run);
  }

  /** The attempt exited: its usage comes with the exit, not from here. */
  drop(key: AttemptKey): void {
    this.buffers.get(key.run)?.pending.delete(keyOf(key));
  }

  clear(): void {
    for (const buffer of this.buffers.values()) {
      if (buffer.timer !== null) clearTimeout(buffer.timer);
    }
    this.buffers.clear();
  }

  private flush(run: string): void {
    const buffer = this.buffers.get(run);
    if (!buffer) return;
    if (buffer.timer !== null) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
    if (buffer.pending.size === 0) {
      this.buffers.delete(run);
      return;
    }
    const updates = [...buffer.pending.values()];
    buffer.pending.clear();
    buffer.timer = setTimeout(() => this.flush(run), this.intervalMs());
    buffer.timer.unref();
    void this.context
      .serial(() => {
        if (this.context.stopping) return Promise.resolve();
        return this.context.apply(buffer.state, { kind: 'attempt_usage', updates });
      })
      .catch(() => undefined);
  }
}
