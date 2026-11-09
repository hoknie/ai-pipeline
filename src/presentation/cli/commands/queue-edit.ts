import { Option } from 'commander';

import { repositoryArgument } from '../../ipc/client/index.ts';
import type { QueueView } from '../../ipc/contract/index.ts';
import { call } from '../context.ts';
import { usage } from '../io.ts';
import { parseDeliveryMode, parseSwitch, readGroups, type QueueTaskOptions } from '../options.ts';
import type { QueueKit } from './queue.ts';

interface EditOptions extends QueueTaskOptions {
  pipeline?: string;
  workflow?: string;
  defaultAutoDeliver?: boolean;
  defaultDeliveryMode?: boolean;
  tags?: boolean;
  skips?: boolean;
}

/** Which of the paired flags (`--after` / `--no-after`, `--parent` / `--no-parent`) were passed. */
interface EditFlags {
  after: boolean;
  noAfter: boolean;
  parent: boolean;
  noParent: boolean;
}

/** Refuses flags that contradict each other. */
function checkEdit(options: EditOptions, flags: EditFlags): void {
  const conflicts: [boolean, string][] = [
    [
      options.pipeline !== undefined && options.workflow !== undefined,
      '--workflow is the old name of --pipeline; pass only --pipeline',
    ],
    [flags.after && flags.noAfter, '--no-after cannot be combined with --after'],
    [flags.parent && flags.noParent, '--no-parent cannot be combined with --parent'],
    [
      options.tags === false && options.tag !== undefined,
      '--no-tags cannot be combined with --tag',
    ],
    [
      options.skips === false && options.skip !== undefined,
      '--no-skips cannot be combined with --skip',
    ],
    [
      options.task !== undefined && options.groups !== undefined,
      'pass at most one of --task and --groups',
    ],
    [
      !!options.defaultAutoDeliver && options.autoDeliver !== undefined,
      '--default-auto-deliver cannot be combined with --auto-deliver',
    ],
    [
      !!options.defaultDeliveryMode && options.deliveryMode !== undefined,
      '--default-delivery-mode cannot be combined with --delivery-mode',
    ],
  ];
  const found = conflicts.find(([clash]) => clash);
  if (found) throw usage(found[1]);
}

/** The fields of `queue_edit` the flags change. */
function editParams(item: string, options: EditOptions, flags: EditFlags) {
  const pipeline = options.pipeline ?? options.workflow;
  const deliveryMode = parseDeliveryMode(options.deliveryMode);
  return {
    repository: repositoryArgument(options.repo),
    item,
    ...(pipeline !== undefined ? { pipeline } : {}),
    ...(options.task !== undefined ? { task: options.task } : {}),
    ...(options.groups !== undefined ? { groups: readGroups(options.groups) } : {}),
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.defaultAutoDeliver
      ? { autoDeliver: null }
      : options.autoDeliver !== undefined
        ? { autoDeliver: options.autoDeliver }
        : {}),
    ...(options.defaultDeliveryMode
      ? { deliveryMode: null }
      : deliveryMode !== undefined
        ? { deliveryMode }
        : {}),
    ...(options.tags === false ? { tags: [] } : {}),
    ...(options.tag !== undefined ? { tags: options.tag } : {}),
    ...(flags.noParent ? { parent: null } : {}),
    ...(flags.parent && typeof options.parent === 'string' ? { parent: options.parent } : {}),
    ...(options.skips === false ? { skip: [] } : {}),
    ...(options.skip !== undefined ? { skip: options.skip } : {}),
    ...(flags.noAfter ? { after: [] } : {}),
    ...(flags.after && options.after !== undefined ? { after: options.after } : {}),
    ...(options.postpone !== undefined ? { postponed: options.postpone } : {}),
  };
}

export function addEdit(kit: QueueKit): void {
  const { examples, context, showQueue, queue, taskOptions, common } = kit;
  const flags: EditFlags = { after: false, noAfter: false, parent: false, noParent: false };
  common(
    taskOptions(
      queue
        .command('edit')
        .on('option:after', () => (flags.after = true))
        .on('option:no-after', () => (flags.noAfter = true))
        .on('option:parent', () => (flags.parent = true))
        .on('option:no-parent', () => (flags.noParent = true))
        .description('Change a waiting task')
        .argument('<item>', 'item id from `aip queue list`')
        .option('-p, --pipeline <id>', 'new pipeline id')
        .addOption(new Option('-w, --workflow <id>', 'old name of --pipeline').hideHelp())
        .option('--default-auto-deliver', 'follow delivery.auto of the configuration again')
        .option('--default-delivery-mode', 'follow delivery.mode of the configuration again')
        .option('--no-tags', 'remove all tags of the task')
        .option('--no-parent', 'remove the linked task tags of the task')
        .option('--no-skips', 'run every step of the pipeline again')
        .option('--no-after', 'remove all predecessors of the task')
        .option('--postpone', 'postpone the task: a running queue does not take it')
        .option('--no-postpone', 'take the task into work again'),
    ),
  )
    .addHelpText(
      'after',
      examples([
        'aip queue edit 1 --task "New wording"',
        'aip queue edit 1 --pipeline feature',
        'aip queue edit 1 --skip qa',
        'aip queue edit 1 --no-skips',
        'aip queue edit 2 --after q1',
        'aip queue edit 2 --no-after',
        'aip queue edit 2 --parent 115',
        'aip queue edit 2 --no-parent',
        'aip queue edit 3 --postpone',
        'aip queue edit 3 --no-postpone',
      ]),
    )
    .action(async (item: string, options: EditOptions) => {
      checkEdit(options, flags);
      const params = editParams(item, options, flags);
      showQueue(options.json, (await call(context(), 'queue_edit', params)) as QueueView);
    });
}

export function addSettings(kit: QueueKit): void {
  const { examples, context, showQueue, queue, common } = kit;
  common(
    queue
      .command('settings')
      .description('Change queue settings; only the passed ones change, takes effect at once')
      .option('-p, --parallel <n>', 'runs at the same time (1-20)')
      .option('--autopilot <on|off>', 'a running queue does not stop when it becomes empty')
      .option('--auto-answer <on|off>', 'a running queue answers specialists questions')
      .option('--skip-failed <on|off>', 'a failed or conflicting run leaves its place')
      .option('--on-limit <wait|stop>', 'on a usage limit: wait for the reset, or stop')
      .option(
        '--autopilot-answer <text>',
        'text the queue answers specialists questions with when auto answer is on',
      )
      .option('--default-autopilot-answer', 'answer with the default text again'),
  )
    .addHelpText(
      'after',
      examples([
        'aip queue settings --autopilot on',
        'aip queue settings --auto-answer on',
        'aip queue settings --skip-failed on --parallel 2',
        'aip queue settings --on-limit stop',
        'aip queue settings --autopilot-answer "Agree; pick the simplest option"',
      ]),
    )
    .action(
      async (options: {
        repo: string;
        parallel?: string;
        autopilot?: string;
        autoAnswer?: string;
        skipFailed?: string;
        onLimit?: string;
        autopilotAnswer?: string;
        defaultAutopilotAnswer?: boolean;
        json?: boolean;
      }) => {
        if (options.onLimit !== undefined && !['wait', 'stop'].includes(options.onLimit)) {
          throw usage('--on-limit must be wait or stop');
        }
        if (options.defaultAutopilotAnswer && options.autopilotAnswer !== undefined) {
          throw usage('--default-autopilot-answer cannot be combined with --autopilot-answer');
        }
        const autopilot = parseSwitch('--autopilot', options.autopilot);
        const autoAnswer = parseSwitch('--auto-answer', options.autoAnswer);
        const skipFailed = parseSwitch('--skip-failed', options.skipFailed);
        showQueue(
          options.json,
          (await call(context(), 'queue_settings', {
            repository: repositoryArgument(options.repo),
            ...(options.parallel !== undefined ? { parallel: Number(options.parallel) } : {}),
            ...(autopilot !== undefined ? { autopilot } : {}),
            ...(autoAnswer !== undefined ? { autoAnswer } : {}),
            ...(skipFailed !== undefined ? { skipFailed } : {}),
            ...(options.onLimit !== undefined ? { onLimit: options.onLimit } : {}),
            ...(options.defaultAutopilotAnswer
              ? { autopilotAnswer: null }
              : options.autopilotAnswer !== undefined
                ? { autopilotAnswer: options.autopilotAnswer }
                : {}),
          })) as QueueView,
        );
      },
    );
}
