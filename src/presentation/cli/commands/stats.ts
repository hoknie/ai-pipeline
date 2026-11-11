import type { Command } from 'commander';

import { parseStatsPeriod } from '../../../feature/stats/types/index.ts';
import { formatStats, type Style } from '../../format/index.ts';
import { repositoryArgument } from '../../ipc/client/index.ts';
import type { StatsClearView, StatsReportView } from '../../ipc/contract/index.ts';
import { bind, call } from '../context.ts';
import { usage, type CliIo } from '../io.ts';

const DEFAULT_PERIOD = '30d';

export function registerStats(program: Command, io: CliIo, style: Style): void {
  const { print, output, examples, context, activeStyle } = bind(io, style);
  program
    .command('stats')
    .description('Usage statistics: tokens, cost and time of the agents, per task and per project')
    .argument('[action]', 'clear: delete the collected statistics of --project; its runs stay')
    .option('-p, --project <path>', 'project path or slug (default: every project)')
    .option('--since <period>', 'period: <n>h, <n>d, <n>w or all', DEFAULT_PERIOD)
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples(['aip stats', 'aip stats --since 7d --json', 'aip stats clear --project .']),
    )
    .action(
      async (
        action: string | undefined,
        options: { project?: string; since: string; json?: boolean },
      ) => {
        if (action === 'clear') {
          if (options.project === undefined) throw usage('pass --project to clear');
          const result = (await call(context(), 'stats_clear', {
            repository: repositoryArgument(options.project, io.cwd),
          })) as StatsClearView;
          print(`Removed ${result.removed} records`);
          return;
        }
        if (action !== undefined) throw usage(`unknown action "${action}": use clear`);
        const period = parseStatsPeriod(options.since, Date.now());
        if (!period.ok) throw usage(period.error);
        const report = (await call(context(), 'stats_report', {
          ...(period.since === null ? {} : { since: period.since }),
          ...(options.project === undefined
            ? {}
            : { repository: repositoryArgument(options.project, io.cwd) }),
        })) as StatsReportView;
        output(options.json, formatStats(report, activeStyle), report);
      },
    );
}
