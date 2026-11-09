import type { Command } from 'commander';

import { DELIVERY_MODES } from '../../../feature/swarm-config/types/index.ts';
import {
  filterByTags,
  formatRun,
  formatRunList,
  formatRunQueued,
  formatTagLabels,
  type Style,
} from '../../format/index.ts';
import { repositoryArgument } from '../../ipc/client/index.ts';
import type { RunQueued, RunView } from '../../ipc/contract/index.ts';
import { bind, call } from '../context.ts';
import { usage, type CliIo } from '../io.ts';
import { collect, parseDeliveryMode, readGroups } from '../options.ts';
import { watch } from '../watch.ts';
import { addApply, addClean, addMarkDelivered, addPause, addSkip } from './run-delivery.ts';

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

interface StartOptions {
  task?: string;
  groups?: string;
  repo: string;
  title?: string;
  autoDeliver?: boolean;
  deliveryMode?: string;
  tag?: string[];
  parent?: string;
  skip?: string[];
  after?: string[];
  json?: boolean;
}

/** The fields of the `run` request the flags of `aip run start` set. */
function startParams(pipeline: string, options: StartOptions) {
  if ((options.task === undefined) === (options.groups === undefined)) {
    throw usage('pass exactly one of --task and --groups');
  }
  const groups = options.groups ? readGroups(options.groups) : undefined;
  const deliveryMode = parseDeliveryMode(options.deliveryMode);
  return {
    repository: repositoryArgument(options.repo),
    pipeline,
    ...(options.task !== undefined ? { task: options.task } : {}),
    ...(groups ? { groups } : {}),
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.autoDeliver !== undefined ? { autoDeliver: options.autoDeliver } : {}),
    ...(deliveryMode !== undefined ? { deliveryMode } : {}),
    ...(options.tag !== undefined ? { tags: options.tag } : {}),
    ...(options.parent !== undefined ? { parent: options.parent } : {}),
    ...(options.skip !== undefined ? { skip: options.skip } : {}),
    ...(options.after !== undefined ? { after: options.after } : {}),
  };
}

function addStart(kit: RunKit): void {
  const { print, output, examples, context, activeStyle, run } = kit;
  run
    .command('start')
    .description(
      'Queue a pipeline task of the aip/ configuration: it goes to the end of the repository queue, a stopped queue is started',
    )
    .argument('<pipeline>', 'pipeline id from the aip/ configuration')
    .option('-t, --task <text>', 'one task; the pipeline may split it into groups')
    .option('-g, --groups <file>', 'YAML or JSON file with a list of { title, task }')
    .option('-r, --repo <path>', 'repository path or project slug', '.')
    .option(
      '--title <text>',
      'title of the run (at most 60 characters); otherwise a model names it',
    )
    .option(
      '--auto-deliver',
      'deliver the merged groups automatically, whatever delivery.auto says',
    )
    .option('--no-auto-deliver', 'leave the merged groups for `aip apply`')
    .option(
      '--delivery-mode <mode>',
      `how the merged result is delivered: ${DELIVERY_MODES.join(', ')}; whatever delivery.mode says`,
    )
    .option('--tag <name>', 'tag of the task; repeat for several', collect)
    .option(
      '--parent <run>',
      'run id or task number (161 or #161) whose linked task tag the task gets',
    )
    .option('--skip <step>', 'step of the pipeline to skip; repeat for several', collect)
    .option(
      '--after <id>',
      'queue item or run that must be done first; repeat for several',
      collect,
    )
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip run start feature --no-auto-deliver --task "Add a login form"',
        'aip run start feature --task "Add a login form"',
        'aip run start feature --title "Login form" --task "Add a login form with OAuth"',
        'aip run start feature --groups groups.yaml --repo ~/projects/app',
        'aip run start feature --task "Add the API" --after q1',
        'aip run start feature --task "Follow-up" --parent 115',
      ]),
    )
    .action(async (pipeline: string, options: StartOptions) => {
      const queued = (await call(context(), 'run', startParams(pipeline, options))) as RunQueued;
      output(options.json, formatRunQueued(queued, activeStyle), queued);
    });
}

function addList(kit: RunKit): void {
  const { print, output, examples, context, activeStyle, run } = kit;
  run
    .command('list')
    .description('Show active and recent runs')
    .option('--tag <name>', 'only runs with this tag; repeat for any of several', collect)
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples(['aip run list', 'aip run list --json', 'aip run list --tag auth --tag v2']),
    )
    .action(async (options: { json?: boolean; tag?: string[] }) => {
      const all = (await call(context(), 'status', {})) as RunView[];
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
  for (const add of [addStart, addList, addTag, addUntag, addShow, addWatch, addCancel]) add(kit);
  for (const add of [addPause, addApply, addMarkDelivered, addSkip, addClean]) add(kit);
}
