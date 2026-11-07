import { resolve } from 'node:path';

import { formatApply, formatQueue, formatRun } from '../../format/index.ts';
import type { ApplyResult, QueueView, RunView } from '../../ipc/contract/index.ts';
import { call } from '../context.ts';
import { usage } from '../io.ts';
import type { RunKit } from './run.ts';

export function addPause(kit: RunKit): void {
  const { print, output, examples, context, activeStyle, run } = kit;
  run
    .command('pause')
    .description(
      'Pause a run: the running agents stop, nothing new starts, and the run goes to the end of the queue; "aip queue run <item>" continues the interrupted step in the same session',
    )
    .argument('<run-id>', 'run id')
    .option('-r, --repo <path>', 'repository path; defaults to the repository of the run')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip run pause 0mh3k2ab1x9z']))
    .action(async (runId: string, options: { repo?: string; json?: boolean }) => {
      const view = (await call(context(), 'run_pause', {
        runId,
        ...(options.repo !== undefined ? { repository: resolve(options.repo) } : {}),
      })) as QueueView & { item: string };
      output(options.json, formatQueue(view, activeStyle), view);
    });
}

export function addApply(kit: RunKit): void {
  const { print, output, examples, context, activeStyle, io, run } = kit;
  run
    .command('apply')
    .description('Deliver merged groups of a run into your working tree (or as delivery.mode says)')
    .argument('<run-id>', 'run id')
    .argument('[groups...]', 'groups to deliver; all merged ones by default')
    .option('--force', 'apply even with conflicts, leaving conflict markers')
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip run apply 0mh3k2ab1x9z',
        'aip run apply 0mh3k2ab1x9z login signup',
        'aip run apply 0mh3k2ab1x9z --force',
      ]),
    )
    .action(
      async (runId: string, groups: string[], options: { force?: boolean; json?: boolean }) => {
        const result = (await call(context(), 'apply', {
          runId,
          ...(groups.length > 0 ? { groups } : {}),
          ...(options.force ? { force: true } : {}),
        })) as ApplyResult;
        output(options.json, formatApply(result, activeStyle), result);
        if (result.groups.some((group) => group.delivery.state === 'apply_failed'))
          io.setExitCode(1);
      },
    );
}

export function addMarkDelivered(kit: RunKit): void {
  const { print, output, examples, context, activeStyle, run } = kit;
  run
    .command('mark-delivered')
    .description('Mark merged groups delivered after you merged them by hand')
    .argument('<run-id>', 'run id')
    .option(
      '--group <slug...>',
      'groups to mark; all merged ones that are not delivered by default',
    )
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip run mark-delivered 0mh3k2ab1x9z',
        'aip run mark-delivered 0mh3k2ab1x9z --group login signup',
      ]),
    )
    .action(async (runId: string, options: { group?: string[]; json?: boolean }) => {
      const result = (await call(context(), 'run_mark_delivered', {
        runId,
        ...(options.group && options.group.length > 0 ? { groups: options.group } : {}),
      })) as ApplyResult;
      output(options.json, formatApply(result, activeStyle), result);
    });
}

export function addSkip(kit: RunKit): void {
  const { print, output, examples, context, activeStyle, run } = kit;
  run
    .command('skip')
    .description(
      'Skip a step of a run that is not finished yet, or bring it back with --off; a running step is stopped without a commit',
    )
    .argument('<run-id>', 'run id')
    .argument('<step>', 'step id')
    .option('--off', 'do not skip the step any more')
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples(['aip run skip 0mh3k2ab1x9z review', 'aip run skip 0mh3k2ab1x9z review --off']),
    )
    .action(async (runId: string, step: string, options: { off?: boolean; json?: boolean }) => {
      const view = (await call(context(), 'run_skip', {
        runId,
        step,
        skip: options.off !== true,
      })) as RunView;
      output(options.json, formatRun(view, Date.now(), activeStyle), view);
    });
}

export function addClean(kit: RunKit): void {
  const { print, output, examples, context, activeStyle, run } = kit;
  run
    .command('clean')
    .description(
      'List finished runs that can be cleaned, or remove the worktrees and group branches of one',
    )
    .argument('[run-id]', 'run id; without it the cleanable runs are listed')
    .option('--all', 'also delete the run branch aip/<run-id>')
    .option('--json', 'print the list of cleanable runs as JSON')
    .addHelpText(
      'after',
      examples([
        'aip run clean',
        'aip run clean --json',
        'aip run clean 0mh3k2ab1x9z',
        'aip run clean 0mh3k2ab1x9z --all',
      ]),
    )
    .action(async (runId: string | undefined, options: { all?: boolean; json?: boolean }) => {
      if (runId === undefined) {
        if (options.all) throw usage('--all needs a <run-id>');
        const { cleanableRuns, formatCleanable } = await import('../local/clean.ts');
        const runs = await cleanableRuns(context());
        output(options.json, formatCleanable(runs, activeStyle), runs);
        return;
      }
      if (options.json) throw usage('--json lists runs and cannot be used with a <run-id>');
      const { cleanRun } = await import('../local/clean.ts');
      for (const removed of await cleanRun(context(), runId, options.all ?? false))
        print(`removed ${removed}`);
    });
}
