import type { Command } from 'commander';

import { formatGroup, formatRun, type Style } from '../../format/index.ts';
import type { GroupView, RunView } from '../../ipc/contract/index.ts';
import { bind, call } from '../context.ts';
import type { CliIo } from '../io.ts';

function groupKit(program: Command, io: CliIo, style: Style) {
  const { print, output, examples, context, activeStyle } = bind(io, style);
  const group = program
    .command('group')
    .description('Inspect and steer one group of a run: attempts, retry, cancel, answer');
  return { print, output, examples, context, activeStyle, io, group };
}

type GroupKit = ReturnType<typeof groupKit>;

function addShow(kit: GroupKit): void {
  const { print, output, examples, context, activeStyle, group } = kit;
  group
    .command('show')
    .description('Show every attempt of a group and the tail of its latest log')
    .argument('<run-id>', 'run id')
    .argument('<group>', 'group slug, or _split for the split step')
    .option('-n, --tail <lines>', 'log lines to show (1-500)', '40')
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip group show 0mh3k2ab1x9z login',
        'aip group show 0mh3k2ab1x9z login --tail 200',
      ]),
    )
    .action(async (runId: string, name: string, options: { tail: string; json?: boolean }) => {
      const view = (await call(context(), 'group', {
        runId,
        group: name,
        tailLines: Number(options.tail),
      })) as GroupView;
      output(options.json, formatGroup(view, activeStyle), view);
    });
}

function addRetry(kit: GroupKit): void {
  const { print, examples, context, activeStyle, group } = kit;
  group
    .command('retry')
    .description(
      'Retry a failed or cancelled group from where it stopped, or its merge after a conflict',
    )
    .argument('<run-id>', 'run id')
    .argument('<group>', 'group slug')
    .option(
      '--refresh-config',
      'take the specialists (model, runtime, prompt, permissions) of the current configuration first',
    )
    .addHelpText(
      'after',
      examples([
        'aip group retry 0mh3k2ab1x9z login',
        'aip group retry 0mh3k2ab1x9z login --refresh-config',
      ]),
    )
    .action(async (runId: string, name: string, options: { refreshConfig?: boolean }) => {
      print(
        formatRun(
          (await call(context(), 'retry', {
            runId,
            group: name,
            ...(options.refreshConfig ? { refreshConfig: true } : {}),
          })) as RunView,
          Date.now(),
          activeStyle,
        ),
      );
    });
}

function addCancel(kit: GroupKit): void {
  const { print, examples, context, activeStyle, group } = kit;
  group
    .command('cancel')
    .description('Cancel one group of a run')
    .argument('<run-id>', 'run id')
    .argument('<group>', 'group slug')
    .addHelpText('after', examples(['aip group cancel 0mh3k2ab1x9z login']))
    .action(async (runId: string, name: string) => {
      const view = (await call(context(), 'cancel', { runId, group: name })) as RunView;
      print(formatRun(view, Date.now(), activeStyle));
    });
}

function addAnswer(kit: GroupKit): void {
  const { print, examples, context, activeStyle, group } = kit;
  group
    .command('answer')
    .description('Answer the question of a group in needs_human')
    .argument('<run-id>', 'run id')
    .argument('<group>', 'group slug')
    .argument('<answer...>', 'the answer')
    .addHelpText('after', examples(['aip group answer 0mh3k2ab1x9z login "Use OAuth with GitHub"']))
    .action(async (runId: string, name: string, words: string[]) => {
      const view = (await call(context(), 'answer', {
        runId,
        group: name,
        answer: words.join(' '),
      })) as RunView;
      print(formatRun(view, Date.now(), activeStyle));
    });
}

export function registerGroup(program: Command, io: CliIo, style: Style): void {
  const kit = groupKit(program, io, style);
  for (const add of [addShow, addRetry, addCancel, addAnswer]) add(kit);
}
