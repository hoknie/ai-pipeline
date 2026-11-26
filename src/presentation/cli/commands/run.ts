import type { Command } from 'commander';

import {
  filterByTags,
  formatLessons,
  formatRun,
  formatRunList,
  formatTagLabels,
  type Style,
} from '../../format/index.ts';
import type { LessonSummaryView, RunView } from '../../ipc/contract/index.ts';
import { bind, call } from '../context.ts';
import type { CliIo } from '../io.ts';
import { addAuthorOptions, authorParameter, collect, type AuthorOptions } from '../options.ts';
import { watch } from '../watch.ts';
import { addContrast, addContrastShow } from './probe/index.ts';
import { addStart } from '../run-start/index.ts';
import {
  addApply,
  addClean,
  addMarkDelivered,
  addPause,
  addProbe,
  addProvider,
  addSkip,
  addVariant,
} from './run-delivery.ts';

function runKit(program: Command, io: CliIo, style: Style) {
  const { print, output, examples, context, activeStyle } = bind(io, style);
  const run = program
    .command('run')
    .description('Start, follow, deliver and clean up runs of a pipeline');
  const showTags = (view: RunView, json: boolean | undefined): void => {
    const labels = formatTagLabels(view.tags, activeStyle);
    output(json, `Tags of run ${view.id}: ${labels || 'none'}`, view);
  };
  return { print, output, examples, context, activeStyle, io, run, showTags };
}

export type RunKit = ReturnType<typeof runKit>;

function addList(kit: RunKit): void {
  const { print, output, examples, context, activeStyle, run } = kit;
  const list = run
    .command('list')
    .description('Show active and recent runs')
    .option('--tag <name>', 'only runs with this tag; repeat for any of several', collect)
    .option('--json', 'print JSON');
  addAuthorOptions(list)
    .addHelpText(
      'after',
      examples([
        'aip run list',
        'aip run list --json',
        'aip run list --tag auth --tag v2',
        'aip run list --mine',
      ]),
    )
    .action(async (options: { json?: boolean; tag?: string[] } & AuthorOptions) => {
      const filter = await authorParameter(context(), options);
      const all = (await call(context(), 'status', filter)) as RunView[];
      const runs = options.tag === undefined ? all : filterByTags(all, options.tag);
      const empty = options.tag !== undefined && runs.length === 0;
      output(
        options.json,
        empty ? 'No runs with these tags.' : formatRunList(runs, activeStyle),
        runs,
      );
    });
}

function addTag(kit: RunKit): void {
  const { print, examples, context, run, showTags } = kit;
  run
    .command('tag')
    .description('Add tags to a run in any state (create a tag with `aip tag add`)')
    .argument('<run-id>', 'run id')
    .argument('<name...>', 'tag names')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip run tag 0mh3k2ab1x9z auth v2']))
    .action(async (runId: string, names: string[], options: { json?: boolean }) => {
      showTags((await call(context(), 'run_tags', { runId, add: names })) as RunView, options.json);
    });
}

function addUntag(kit: RunKit): void {
  const { print, examples, context, run, showTags } = kit;
  run
    .command('untag')
    .description('Remove tags from a run in any state')
    .argument('<run-id>', 'run id')
    .argument('<name...>', 'tag names')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip run untag 0mh3k2ab1x9z v2']))
    .action(async (runId: string, names: string[], options: { json?: boolean }) => {
      showTags(
        (await call(context(), 'run_tags', { runId, remove: names })) as RunView,
        options.json,
      );
    });
}

function addShow(kit: RunKit): void {
  const { print, output, examples, context, activeStyle, run } = kit;
  run
    .command('show')
    .description('Show the groups of one run')
    .argument('<run-id>', 'run id')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip run show 0mh3k2ab1x9z']))
    .action(async (runId: string, options: { json?: boolean }) => {
      const view = (await call(context(), 'status', { runId })) as RunView;
      output(options.json, formatRun(view, Date.now(), activeStyle), view);
    });
}

function addLessons(kit: RunKit): void {
  const { output, examples, context, activeStyle, run } = kit;
  run
    .command('lessons')
    .description('Show the lessons a run leaves to later attempts of its repository')
    .argument('<run-id>', 'run id')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip run lessons 0mh3k2ab1x9z']))
    .action(async (runId: string, options: { json?: boolean }) => {
      const view = (await call(context(), 'run_lessons', { runId })) as LessonSummaryView;
      output(options.json, formatLessons(view, activeStyle), view);
    });
}

function addWatch(kit: RunKit): void {
  const { examples, context, io, run } = kit;
  run
    .command('watch')
    .description('Follow a run until it finishes')
    .argument('[run-id]', 'run id; defaults to the latest active run')
    .addHelpText('after', examples(['aip run watch', 'aip run watch 0mh3k2ab1x9z']))
    .action(async (runId: string | undefined) => {
      await watch(context(), runId, io.watchIntervalMs);
    });
}

function addCancel(kit: RunKit): void {
  const { print, examples, context, activeStyle, run } = kit;
  run
    .command('cancel')
    .description('Cancel a whole run')
    .argument('<run-id>', 'run id')
    .addHelpText('after', examples(['aip run cancel 0mh3k2ab1x9z']))
    .action(async (runId: string) => {
      const view = (await call(context(), 'cancel', { runId })) as RunView;
      print(formatRun(view, Date.now(), activeStyle));
    });
}

export function registerRun(program: Command, io: CliIo, style: Style): void {
  const kit = runKit(program, io, style);
  for (const add of [addStart, addList, addTag, addUntag, addShow, addWatch, addCancel, addLessons])
    add(kit);
  for (const add of [addPause, addApply, addMarkDelivered, addSkip, addVariant, addProbe, addClean])
    add(kit);
  addProvider(kit);
  addContrast(kit);
  addContrastShow(kit);
}
