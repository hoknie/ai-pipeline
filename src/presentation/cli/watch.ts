import { activityLines, formatRun } from '../format/index.ts';
import type { GroupView, RunView } from '../ipc/contract/index.ts';

import { call, type Context } from './context.ts';
import { invalid } from '../../platform/errors/index.ts';

export const WATCH_INTERVAL_MS = 1000;
/** Group logs are asked of the daemon at most this often. */
export const ACTIVITY_INTERVAL_MS = 2000;

const ENTER_SCREEN = '\x1b[?1049h\x1b[?25l';
const LEAVE_SCREEN = '\x1b[?25h\x1b[?1049l';
const HOME = '\x1b[H';
const ERASE_LINE_END = '\x1b[K';
const ERASE_BELOW = '\x1b[J';

export interface Frame<T> {
  text: string;
  value: T;
  done: boolean;
}

/**
 * Draws views until one is `done`. On a terminal: alternate screen, hidden cursor, every view
 * from the top-left corner without clearing the whole screen; on exit, or on SIGINT (130) and
 * SIGTERM (143), the screen is restored and the last view is printed once. Otherwise every
 * view is printed whole, separated by an empty line.
 */
export async function redrawLoop<T>(
  ctx: Context,
  render: () => Promise<Frame<T>>,
  interval: number = WATCH_INTERVAL_MS,
): Promise<T> {
  const { io } = ctx;
  const interactive = io.isTTY;
  let last = '';
  let stopped = false;
  let left = false;
  const leave = (): void => {
    if (!interactive || left) return;
    left = true;
    io.stdout(`${LEAVE_SCREEN}${last === '' ? '' : `${last}\n`}`);
  };
  const stopOn = (signal: 'SIGINT' | 'SIGTERM', code: number): void => {
    if (!interactive) return;
    io.onSignal(signal, () => {
      stopped = true;
      leave();
      io.exit(code);
    });
  };
  if (interactive) {
    io.stdout(ENTER_SCREEN);
    stopOn('SIGINT', 130);
    stopOn('SIGTERM', 143);
  }
  try {
    for (;;) {
      const frame = await render();
      if (stopped) return frame.value;
      last = frame.text;
      if (interactive) {
        const body = frame.text
          .split('\n')
          .map((line) => `${line}${ERASE_LINE_END}`)
          .join('\n');
        io.stdout(`${HOME}${body}\n${ERASE_BELOW}`);
      } else io.stdout(`${frame.text}\n\n`);
      if (frame.done) return frame.value;
      await new Promise((resolve) => setTimeout(resolve, interval));
      if (stopped) return frame.value;
    }
  } finally {
    leave();
  }
}

export async function watch(
  ctx: Context,
  runId: string | undefined,
  interval: number = WATCH_INTERVAL_MS,
): Promise<RunView> {
  const target = runId ?? (await latestActive(ctx));
  const cache = { at: -Infinity, lines: new Map<string, string>() };
  return redrawLoop(
    ctx,
    async () => {
      const view = (await call(ctx, 'status', { runId: target })) as RunView;
      const lines = await activity(ctx, view, cache);
      return {
        text: formatRun(view, Date.now(), ctx.style, activityLines(lines, ctx.style)),
        value: view,
        done: view.finished,
      };
    },
    interval,
  );
}

interface ActivityCache {
  at: number;
  lines: Map<string, string>;
}

/** Last log line of every running group; asked of the daemon at most every 2 s. */
async function activity(
  ctx: Context,
  view: RunView,
  cache: ActivityCache,
): Promise<ReadonlyMap<string, string>> {
  const running = view.groups.filter((group) => group.status === 'running');
  if (Date.now() - cache.at >= ACTIVITY_INTERVAL_MS) {
    cache.at = Date.now();
    const lines = new Map<string, string>();
    for (const group of running) {
      try {
        const details = (await call(ctx, 'group', {
          runId: view.id,
          group: group.slug,
          tailLines: 1,
        })) as GroupView;
        const line = details.log?.lines.findLast((text) => text.trim() !== '');
        if (line !== undefined) lines.set(group.slug, line);
      } catch {
        // The group's line is skipped; the view still draws.
      }
    }
    cache.lines = lines;
  }
  const shown = new Map<string, string>();
  for (const group of running) {
    const line = cache.lines.get(group.slug);
    if (line !== undefined) shown.set(group.slug, line);
  }
  return shown;
}

async function latestActive(ctx: Context): Promise<string> {
  const runs = (await call(ctx, 'status', {})) as RunView[];
  const active = runs.filter((run) => !run.finished).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!active) throw invalid('cli.watch', 'no active runs; pass a run id');
  return active.id;
}
