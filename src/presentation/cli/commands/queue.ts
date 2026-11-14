import { Option, type Command } from 'commander';

import { DELIVERY_MODES } from '../../../feature/swarm-config/types/index.ts';
import { formatQueue, formatRunCreated, type Style } from '../../format/index.ts';
import { repositoryArgument } from '../../ipc/client/index.ts';
import type { QueueView, RunCreated } from '../../ipc/contract/index.ts';
import { bind, call } from '../context.ts';
import { usage, type CliIo } from '../io.ts';
import {
  attachmentSources,
  collect,
  parseDeliveryMode,
  readGroups,
  type QueueTaskOptions,
} from '../options.ts';
import { addEdit, addSettings } from './queue-edit.ts';

function queueKit(program: Command, io: CliIo, style: Style) {
  const { print, output, examples, context, activeStyle } = bind(io, style);
  const showQueue = (json: boolean | undefined, view: QueueView): void =>
    output(json, formatQueue(view, activeStyle), view);
  const queue = program
    .command('queue')
    .description('Tasks waiting for a start: add, reorder and run them one by one or in parallel');
  const taskOptions = (command: Command): Command =>
    command
      .option('-t, --task <text>', 'one task; the pipeline may split it into groups')
      .option('-g, --groups <file>', 'YAML or JSON file with a list of { title, task }')
      .option('--title <text>', 'title of the run (at most 60 characters)')
      .option(
        '--auto-deliver',
        'deliver the merged groups automatically, whatever delivery.auto says',
      )
      .option('--no-auto-deliver', 'leave the merged groups for `aip apply`')
      .option(
        '--delivery-mode <mode>',
        `how the merged result is delivered: ${DELIVERY_MODES.join(', ')}; whatever delivery.mode says`,
      )
      .option('--attach <path>', 'file to attach to the task; repeat for several', collect)
      .option('--tag <name>', 'tag of the task; repeat for several', collect)
      .option(
        '--parent <run>',
        'run id or task number (161 or #161) whose linked task tag the task gets',
      )
      .option(
        '--variant <id>',
        'variant of the pipeline (other models, specialists or skipped steps); default: the pipeline as it is',
      )
      .option('--skip <step>', 'step of the pipeline to skip; repeat for several', collect)
      .option(
        '--after <id>',
        'queue item or run that must be done first; repeat for several',
        collect,
      );
  const common = (command: Command): Command =>
    command
      .option('-r, --repo <path>', 'repository path or project slug', '.')
      .option('--json', 'print JSON');
  return {
    print,
    output,
    examples,
    context,
    activeStyle,
    io,
    showQueue,
    queue,
    taskOptions,
    common,
  };
}

export type QueueKit = ReturnType<typeof queueKit>;

function addList(kit: QueueKit): void {
  const { examples, context, showQueue, queue, common } = kit;
  common(queue.command('list').description('Show the queue of the repository'))
    .addHelpText('after', examples(['aip queue list', 'aip queue list --json']))
    .action(async (options: { repo: string; json?: boolean }) => {
      showQueue(
        options.json,
        (await call(context(), 'queue', {
          repository: repositoryArgument(options.repo),
        })) as QueueView,
      );
    });
}

function addAdd(kit: QueueKit): void {
  const { print, examples, context, showQueue, queue, taskOptions, common } = kit;
  common(
    taskOptions(
      queue
        .command('add')
        .description('Add a task to the end of the queue; it does not start the queue')
        .argument('<pipeline>', 'pipeline id from swarm.yaml')
        .option('--postpone', 'postpone the task: a running queue does not take it'),
    ),
  )
    .addHelpText(
      'after',
      examples([
        'aip queue add feature --task "Add a login form"',
        'aip queue add feature -g g.yaml',
        'aip queue add feature --task "Fix the typo" --skip review --skip qa',
        'aip queue add feature --task "Add the API" --after q1',
        'aip queue add feature --task "Fix the layout" --attach shot.png --attach spec.pdf',
        'aip queue add feature --task "Follow-up" --parent 115',
        'aip queue add feature --task "Later" --postpone',
      ]),
    )
    .action(async (pipeline: string, options: QueueTaskOptions) => {
      if ((options.task === undefined) === (options.groups === undefined)) {
        throw usage('pass exactly one of --task and --groups');
      }
      const deliveryMode = parseDeliveryMode(options.deliveryMode);
      const view = (await call(context(), 'queue_add', {
        repository: repositoryArgument(options.repo),
        pipeline,
        ...(options.task !== undefined ? { task: options.task } : {}),
        ...(options.groups !== undefined ? { groups: readGroups(options.groups) } : {}),
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.autoDeliver !== undefined ? { autoDeliver: options.autoDeliver } : {}),
        ...(deliveryMode !== undefined ? { deliveryMode } : {}),
        ...(options.tag !== undefined ? { tags: options.tag } : {}),
        ...(typeof options.parent === 'string' ? { parent: options.parent } : {}),
        ...(options.variant !== undefined ? { variant: options.variant } : {}),
        ...(options.skip !== undefined ? { skip: options.skip } : {}),
        ...(options.after !== undefined ? { after: options.after } : {}),
        ...(options.attach !== undefined ? { attachments: attachmentSources(options.attach) } : {}),
        ...(options.postpone ? { postponed: true } : {}),
      })) as QueueView & { item: string };
      if (!options.json) print(`Added ${view.item}.`);
      showQueue(options.json, view);
    });
}

function addRemove(kit: QueueKit): void {
  const { examples, context, showQueue, queue, common } = kit;
  common(
    queue
      .command('remove')
      .description('Remove a waiting task')
      .argument('<item>', 'item id from `aip queue list`'),
  )
    .addHelpText('after', examples(['aip queue remove 1']))
    .action(async (item: string, options: { repo: string; json?: boolean }) => {
      showQueue(
        options.json,
        (await call(context(), 'queue_remove', {
          repository: repositoryArgument(options.repo),
          item,
        })) as QueueView,
      );
    });
}

function addMove(kit: QueueKit): void {
  const { examples, context, showQueue, queue, common } = kit;
  common(
    queue
      .command('move')
      .description('Move a waiting task to a position (1 is the first to start)')
      .argument('<item>', 'item id')
      .argument('<position>', 'new position, from 1'),
  )
    .addHelpText('after', examples(['aip queue move 3 1']))
    .action(async (item: string, position: string, options: { repo: string; json?: boolean }) => {
      showQueue(
        options.json,
        (await call(context(), 'queue_edit', {
          repository: repositoryArgument(options.repo),
          item,
          position: Number(position),
        })) as QueueView,
      );
    });
}

function addStart(kit: QueueKit): void {
  const { examples, context, showQueue, queue, common } = kit;
  common(
    queue
      .command('start')
      .description('Start the queue: take tasks from the beginning, `parallel` at a time')
      .option('-p, --parallel <n>', 'runs at the same time (1-20)'),
  )
    .addHelpText('after', examples(['aip queue start', 'aip queue start --parallel 2']))
    .action(async (options: { repo: string; parallel?: string; json?: boolean }) => {
      showQueue(
        options.json,
        (await call(context(), 'queue_start', {
          repository: repositoryArgument(options.repo),
          ...(options.parallel !== undefined ? { parallel: Number(options.parallel) } : {}),
        })) as QueueView,
      );
    });
}

function addParallel(kit: QueueKit): void {
  const { examples, context, showQueue, queue, common } = kit;
  common(
    queue
      .command('parallel')
      .description('Change how many runs the queue holds at the same time; takes effect at once')
      .argument('<n>', 'runs at the same time (1-20)'),
  )
    .addHelpText('after', examples(['aip queue parallel 3']))
    .action(async (n: string, options: { repo: string; json?: boolean }) => {
      showQueue(
        options.json,
        (await call(context(), 'queue_settings', {
          repository: repositoryArgument(options.repo),
          parallel: Number(n),
        })) as QueueView,
      );
    });
}

function addPause(kit: QueueKit): void {
  const { examples, context, showQueue, queue, common } = kit;
  common(queue.command('pause').description('Stop taking tasks; runs already started keep going'))
    .addHelpText('after', examples(['aip queue pause']))
    .action(async (options: { repo: string; json?: boolean }) => {
      showQueue(
        options.json,
        (await call(context(), 'queue_pause', {
          repository: repositoryArgument(options.repo),
        })) as QueueView,
      );
    });
}

function addReturn(kit: QueueKit): void {
  const { print, examples, context, showQueue, queue } = kit;
  queue
    .command('return')
    .description(
      'Put a run with failed or cancelled groups back into its queue as the first task; when taken, it continues where it stopped',
    )
    .argument('<run-id>', 'run id')
    .option('-r, --repo <path>', 'repository path; defaults to the repository of the run')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip queue return mvzh40j56lht']))
    .action(async (run: string, options: { repo?: string; json?: boolean }) => {
      const view = (await call(context(), 'queue_return', {
        runId: run,
        ...(options.repo !== undefined ? { repository: repositoryArgument(options.repo) } : {}),
      })) as QueueView & { item: string };
      showQueue(options.json, view);
    });
}

function addDismiss(kit: QueueKit): void {
  const { print, examples, context, showQueue, queue } = kit;
  queue
    .command('dismiss')
    .description(
      'Remove a skipped run from the skipped list of its queue; the run itself does not change',
    )
    .argument('<run-id>', 'run id')
    .option('-r, --repo <path>', 'repository path; defaults to the repository of the run')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip queue dismiss mvzh40j56lht']))
    .action(async (run: string, options: { repo?: string; json?: boolean }) => {
      const view = (await call(context(), 'queue_dismiss', {
        runId: run,
        ...(options.repo !== undefined ? { repository: repositoryArgument(options.repo) } : {}),
      })) as QueueView;
      showQueue(options.json, view);
    });
}

function addRunNow(kit: QueueKit): void {
  const { output, examples, context, activeStyle, queue, common } = kit;
  common(
    queue
      .command('run')
      .description(
        'Turn a waiting task into a run right now, over the parallel limit; the run holds a place',
      )
      .argument('<item>', 'item id'),
  )
    .addHelpText('after', examples(['aip queue run 2']))
    .action(async (item: string, options: { repo: string; json?: boolean }) => {
      const repository = repositoryArgument(options.repo);
      const created = (await call(context(), 'queue_run_now', {
        repository,
        item,
      })) as RunCreated;
      if (options.json) {
        output(true, '', created);
        return;
      }
      const queue = (await call(context(), 'queue', { repository })) as QueueView;
      output(
        false,
        `${formatRunCreated(created, activeStyle)}\nQueue: ${queue.runs.length} of ${queue.parallel} places taken.`,
        created,
      );
    });
}

export function registerQueue(program: Command, io: CliIo, style: Style): void {
  const kit = queueKit(program, io, style);
  for (const add of [addList, addAdd, addEdit, addRemove, addMove, addStart, addParallel]) {
    add(kit);
  }
  for (const add of [addSettings, addPause, addReturn, addDismiss, addRunNow]) add(kit);
}
