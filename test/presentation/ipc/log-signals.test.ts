import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RunState } from '../../../src/feature/runs/types/index.ts';
import { parseRequest, streamEventSchema } from '../../../src/presentation/ipc/contract/index.ts';
import { LOG_EVENT_MS, LogSignals } from '../../../src/presentation/ipc/log-signals.ts';

afterEach(() => vi.useRealTimers());

const KEY = { run: 'r1', group: 'login', seq: 2 };

function signals(): { logs: LogSignals; lines: Record<string, unknown>[] } {
  let seq = 0;
  const logs = new LogSignals(Date.now, () => (seq += 1));
  return { logs, lines: [] };
}

/** A run with one attempt of `login` in the given status. */
function run(status: string): RunState {
  return {
    run: { id: 'r1' },
    groups: [{ slug: 'login', attempts: [{ seq: 2, status }] }],
  } as unknown as RunState;
}

describe('log event contract', () => {
  it('accepts a subscription with and without logs', () => {
    expect(parseRequest('{"id":1,"method":"subscribe","params":{"logs":true}}')).toMatchObject({
      request: { method: 'subscribe', params: { logs: true } },
    });
    expect(parseRequest('{"id":1,"method":"subscribe","params":{}}')).toMatchObject({
      request: { method: 'subscribe', params: {} },
    });
    expect(parseRequest('{"id":1,"method":"subscribe","params":{"logs":"yes"}}')).toMatchObject({
      code: 'invalid_params',
    });
  });

  it('accepts a log event and refuses one that carries the text of the log', () => {
    const event = { event: 'log', seq: 7, runId: 'r1', group: 'login', attempt: 2 };
    expect(streamEventSchema.parse(event)).toEqual(event);
    expect(streamEventSchema.safeParse({ ...event, text: 'secret' }).success).toBe(false);
    expect(streamEventSchema.safeParse({ ...event, lines: ['secret'] }).success).toBe(false);
  });
});

describe('LogSignals', () => {
  it('sends at most one event per quiet time and covers the lines in between with the next', () => {
    vi.useFakeTimers();
    const { logs, lines } = signals();
    logs.add((line) => lines.push(JSON.parse(line) as Record<string, unknown>));
    // 50 lines within 100 ms
    for (let index = 0; index < 50; index += 1) {
      logs.grew(KEY);
      vi.advanceTimersByTime(2);
    }
    expect(lines).toHaveLength(1);
    vi.advanceTimersByTime(LOG_EVENT_MS);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({ event: 'log', seq: 2, runId: 'r1', group: 'login', attempt: 2 });
    vi.advanceTimersByTime(LOG_EVENT_MS * 3);
    expect(lines).toHaveLength(2);
  });

  it('sends nothing and counts nothing without subscribers', () => {
    const { logs, lines } = signals();
    logs.grew(KEY);
    const drop = logs.add((line) => lines.push(JSON.parse(line) as Record<string, unknown>));
    expect(lines).toHaveLength(0);
    logs.grew(KEY);
    expect(lines.map((line) => line.seq)).toEqual([1]);
    drop();
    logs.grew(KEY);
    expect(lines).toHaveLength(1);
  });

  it('sends the last event at once when the attempt no longer runs', () => {
    vi.useFakeTimers();
    const { logs, lines } = signals();
    logs.add((line) => lines.push(JSON.parse(line) as Record<string, unknown>));
    logs.grew(KEY);
    logs.grew(KEY);
    logs.runChanged(run('running'));
    expect(lines).toHaveLength(1);
    logs.runChanged(run('done'));
    expect(lines).toHaveLength(2);
    // the waiting event went with the last one, and the attempt is no longer watched
    vi.advanceTimersByTime(LOG_EVENT_MS * 2);
    logs.runChanged(run('done'));
    expect(lines).toHaveLength(2);
  });
});
