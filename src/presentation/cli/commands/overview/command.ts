import type { Command } from 'commander';

import {
  formatOverview,
  overviewJson,
  type OverviewData,
  type Style,
} from '../../../format/index.ts';
import type {
  PingResult,
  QueueView,
  RepositoryView,
  RunView,
  WebStatusResult,
} from '../../../ipc/contract/index.ts';
import { bind, call, daemon, type Context } from '../../context.ts';
import { usage, type CliIo } from '../../io.ts';
import { WATCH_INTERVAL_MS, redrawLoop } from '../../watch.ts';

/** Asks the daemon for what the summary shows; `queue` only for projects that have work. */
export async function collectOverview(ctx: Context): Promise<OverviewData> {
  await daemon(ctx);
  const [ping, panel, repositories, runs] = await Promise.all([
    call(ctx, 'ping', {}) as Promise<PingResult>,
    (call(ctx, 'web_status', {}) as Promise<WebStatusResult>).catch(() => null),
    call(ctx, 'repositories', {}) as Promise<RepositoryView[]>,
    call(ctx, 'status', {}) as Promise<RunView[]>,
  ]);
  const working = repositories.filter(
    (repository) => repository.enabled && (repository.unfinished > 0 || repository.queued > 0),
  );
  const projects = await Promise.all(
    working.map(async (repository) => ({
      repository,
      queue: (await call(ctx, 'queue', { repository: repository.path })) as QueueView,
    })),
  );
  return {
    daemon: {
      version: ping.build?.version ?? null,
      pid: ping.pid ?? null,
      busy: ping.busy ?? false,
      network: ping.network?.state ?? 'off',
      panel: panel?.running ? panel.url : null,
    },
    projects,
    repositories,
    runs,
  };
}

export function registerOverview(program: Command, io: CliIo, style: Style): void {
  const { print, examples, context, activeStyle } = bind(io, style);
  program
    .command('overview')
    .description('What runs and what waits for you, across all projects')
    .option('--json', 'print JSON')
    .option('--watch', 'redraw the summary until interrupted')
    .addHelpText('after', examples(['aip overview', 'aip overview --watch', 'aip overview --json']))
    .action(async (options: { json?: boolean; watch?: boolean }) => {
      if (options.watch && options.json) throw usage('--watch cannot be combined with --json');
      const ctx = context();
      if (options.watch) {
        await redrawLoop(
          ctx,
          async () => {
            const data = await collectOverview(ctx);
            return { text: formatOverview(data, activeStyle), value: data, done: false };
          },
          io.watchIntervalMs ?? WATCH_INTERVAL_MS,
        );
        return;
      }
      const data = await collectOverview(ctx);
      print(
        options.json
          ? JSON.stringify(overviewJson(data), null, 2)
          : formatOverview(data, activeStyle),
      );
    });
}
