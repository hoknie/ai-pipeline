import { formatRun, type RunView } from '../protocol/index.ts';

import { call, type Context } from './commands.ts';

export const WATCH_INTERVAL_MS = 1000;

export async function watch(
  ctx: Context,
  runId: string | undefined,
  interval = WATCH_INTERVAL_MS,
): Promise<RunView> {
  const target = runId ?? (await latestActive(ctx));
  const interactive = process.stdout.isTTY === true;
  for (;;) {
    const view = (await call(ctx, 'status', { runId: target })) as RunView;
    const text = formatRun(view, Date.now(), ctx.style);
    process.stdout.write(interactive ? `\x1b[2J\x1b[H${text}\n` : `${text}\n\n`);
    if (view.finished) return view;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

async function latestActive(ctx: Context): Promise<string> {
  const runs = (await call(ctx, 'status', {})) as RunView[];
  const active = runs.filter((run) => !run.finished).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!active) throw new Error('no active runs; pass a run id');
  return active.id;
}
