import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStyle, plainStyle } from '../../src/presentation/format/index.ts';
import type { CliIo } from '../../src/presentation/cli/io.ts';
import type { Context } from '../../src/presentation/cli/context.ts';
import type { RunView } from '../../src/presentation/ipc/contract/index.ts';
import { runView } from '../../src/presentation/ipc/views/index.ts';
import { run } from '../feature/runs/helpers.ts';

const calls: { method: string; params: unknown }[] = [];
let answer: (method: string, params: unknown) => unknown = () => undefined;

vi.mock('../../src/presentation/cli/context.ts', () => ({
  call: async (_ctx: unknown, method: string, params: unknown) => {
    calls.push({ method, params });
    return answer(method, params);
  },
}));

const { redrawLoop, watch, ACTIVITY_INTERVAL_MS } =
  await import('../../src/presentation/cli/watch.ts');

function fakeContext(isTTY: boolean, style = plainStyle) {
  const out: string[] = [];
  const signals = new Map<string, () => void>();
  const exits: number[] = [];
  const io = {
    isTTY,
    stdout: (text: string) => void out.push(text),
    onSignal: (signal: string, handler: () => void) => void signals.set(signal, handler),
    exit: (code: number) => void exits.push(code),
  } as unknown as CliIo;
  return { ctx: { io, style } as unknown as Context, out, signals, exits };
}

function runningView(finished: boolean): RunView {
  const state = run(1);
  state.groups[0]!.status = 'running';
  return { ...runView(state, 1000), finished };
}

beforeEach(() => {
  calls.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('redrawLoop', () => {
  it('draws on the alternate screen without clearing it and restores it at the end', async () => {
    const { ctx, out } = fakeContext(true);
    let n = 0;
    await redrawLoop(ctx, async () => ({ text: `view ${++n}\nline`, value: n, done: n === 2 }), 1);
    expect(out[0]).toBe('\x1b[?1049h\x1b[?25l');
    expect(out[1]).toBe('\x1b[Hview 1\x1b[K\nline\x1b[K\n\x1b[J');
    expect(out[2]).toBe('\x1b[Hview 2\x1b[K\nline\x1b[K\n\x1b[J');
    expect(out[3]).toBe('\x1b[?25h\x1b[?1049lview 2\nline\n');
    expect(out.join('')).not.toContain('\x1b[2J');
    expect(out).toHaveLength(4);
  });

  it('prints whole views separated by an empty line outside a terminal', async () => {
    const { ctx, out, signals } = fakeContext(false);
    let n = 0;
    await redrawLoop(ctx, async () => ({ text: `view ${++n}`, value: n, done: n === 2 }), 1);
    expect(out).toEqual(['view 1\n\n', 'view 2\n\n']);
    expect(signals.size).toBe(0);
  });

  it('restores the screen and exits with 130 on SIGINT and 143 on SIGTERM', async () => {
    for (const [signal, code] of [
      ['SIGINT', 130],
      ['SIGTERM', 143],
    ] as const) {
      const { ctx, out, signals, exits } = fakeContext(true);
      let n = 0;
      await redrawLoop(
        ctx,
        async () => {
          n += 1;
          if (n === 2) signals.get(signal)?.();
          return { text: `view ${n}`, value: n, done: false };
        },
        1,
      );
      expect(exits).toEqual([code]);
      expect(out.at(-1)).toBe('\x1b[?25h\x1b[?1049lview 1\n');
      expect(out.join('')).not.toContain('\x1b[2J');
    }
  });
});

describe('watch activity', () => {
  it('asks for the group log at most every two seconds and only for running groups', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const views = [runningView(false), runningView(false), runningView(false), runningView(true)];
    let status = 0;
    answer = (method) => {
      if (method === 'status') return views[Math.min(status++, views.length - 1)];
      return { log: { seq: 1, lines: ['Editing src/login.ts', ''] } };
    };
    const { ctx, out } = fakeContext(false);
    const done = watch(ctx, 'r1', 1000);
    await vi.advanceTimersByTimeAsync(3500);
    await done;
    const groupCalls = calls.filter((entry) => entry.method === 'group');
    expect(groupCalls.length).toBe(2);
    expect(groupCalls[0]?.params).toMatchObject({ tailLines: 1 });
    expect(ACTIVITY_INTERVAL_MS).toBe(2000);
    expect(out.every((text) => text.includes('gruppa-1: Editing src/login.ts'))).toBe(true);
  });

  it('skips the line of a group whose request fails and still draws', async () => {
    answer = (method) => {
      if (method === 'group') throw new Error('gone');
      return runningView(true);
    };
    const { ctx, out } = fakeContext(false, createStyle(false));
    await watch(ctx, 'r1', 1);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain('gruppa-1:');
  });

  it('asks for no logs when no group runs', async () => {
    const state = run(1);
    answer = () => ({ ...runView(state, 1000), finished: true });
    const { ctx } = fakeContext(false);
    await watch(ctx, 'r1', 1);
    expect(calls.map((entry) => entry.method)).toEqual(['status']);
  });
});
