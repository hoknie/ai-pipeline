import { DELIVERY_MODES } from '../../../feature/swarm-config/types/index.ts';
import { formatRunQueued } from '../../format/index.ts';
import { repositoryArgument } from '../../ipc/client/index.ts';
import type { RunQueued } from '../../ipc/contract/index.ts';
import { call } from '../context.ts';
import { usage } from '../io.ts';
import { linkInputsOf } from '../links.ts';
import {
  ALLOW_DUPLICATE_HELP,
  attachmentSources,
  checkTitle,
  collect,
  parseDeliveryMode,
  parseDeliveryBranch,
  readGroups,
  withDuplicateHint,
} from '../options.ts';
import type { RunKit } from '../commands/run.ts';

interface StartOptions {
  task?: string;
  groups?: string;
  repo: string;
  title?: string;
  autoDeliver?: boolean;
  deliveryMode?: string;
  deliveryBranch?: string;
  deliveryBranchStrategy?: string;
  tag?: string[];
  parent?: string;
  variant?: string;
  /** A provider id; `false` after `--no-provider`. */
  provider?: string | false;
  skip?: string[];
  after?: string[];
  /** `false` after `--no-inherit-tags`. */
  inheritTags?: boolean;
  attach?: string[];
  link?: string[];
  allowDuplicate?: boolean;
  json?: boolean;
}

/** The fields of the `run` request the flags of `aip run start` set. */
function startParams(pipeline: string, options: StartOptions) {
  if ((options.task === undefined) === (options.groups === undefined)) {
    throw usage('pass exactly one of --task and --groups');
  }
  checkTitle(options.title);
  const groups = options.groups ? readGroups(options.groups) : undefined;
  const deliveryMode = parseDeliveryMode(options.deliveryMode);
  const deliveryBranch = parseDeliveryBranch(
    options.deliveryBranch,
    options.deliveryBranchStrategy,
  );
  const links = linkInputsOf(options, {
    after: options.after !== undefined,
    parent: options.parent !== undefined,
  });
  return {
    repository: repositoryArgument(options.repo),
    pipeline,
    ...(options.task !== undefined ? { task: options.task } : {}),
    ...(groups ? { groups } : {}),
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.autoDeliver !== undefined ? { autoDeliver: options.autoDeliver } : {}),
    ...(deliveryMode !== undefined ? { deliveryMode } : {}),
    ...(deliveryBranch !== undefined ? { deliveryBranch } : {}),
    ...(options.tag !== undefined ? { tags: options.tag } : {}),
    ...(options.parent !== undefined ? { parent: options.parent } : {}),
    ...(options.variant !== undefined ? { variant: options.variant } : {}),
    ...(typeof options.provider === 'string' ? { provider: options.provider } : {}),
    ...(options.provider === false ? { provider: null } : {}),
    ...(options.skip !== undefined ? { skip: options.skip } : {}),
    ...(options.after !== undefined ? { after: options.after } : {}),
    ...(options.inheritTags === false ? { inheritTags: false } : {}),
    ...(links !== undefined ? { links } : {}),
    ...(options.attach !== undefined ? { attachments: attachmentSources(options.attach) } : {}),
    ...(options.allowDuplicate ? { allowDuplicate: true } : {}),
  };
}

export function addStart(kit: RunKit): void {
  const { print, output, examples, context, activeStyle, run } = kit;
  const given = { provider: false, noProvider: false };
  run
    .command('start')
    .on('option:provider', () => (given.provider = true))
    .on('option:no-provider', () => (given.noProvider = true))
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
    .option('--delivery-branch <name>', 'local target branch for automatic commit delivery')
    .option(
      '--delivery-branch-strategy <existing|create>',
      'select an existing branch or create one',
    )
    .option('--tag <name>', 'tag of the task; repeat for several', collect)
    .option(
      '--parent <run>',
      'run id or task number (161 or #161) whose linked task tag the task gets',
    )
    .option(
      '--variant <id>',
      'variant of the pipeline (other models, specialists or skipped steps); default: the pipeline as it is',
    )
    .option(
      '--provider <id>',
      'provider of the run: every step with a chain takes its item from this provider; default: the default provider of the project',
    )
    .option('--no-provider', 'no provider, even when the configuration has a default provider')
    .option('--skip <step>', 'step of the pipeline to skip; repeat for several', collect)
    .option(
      '--after <id>',
      'queue item or run that must be done first; repeat for several',
      collect,
    )
    .option('--no-inherit-tags', 'the task takes no tags of its predecessors, now and later')
    .option(
      '--link <kind>:<task>',
      'link of the task, e.g. related:#12; repeat for several',
      collect,
    )
    .option('--attach <path>', 'file to attach to the task; repeat for several', collect)
    .option('--allow-duplicate', ALLOW_DUPLICATE_HELP)
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip run start feature --no-auto-deliver --task "Add a login form"',
        'aip run start feature --task "Add a login form"',
        'aip run start feature --task "Fix the layout" --attach shot.png',
      ]),
    )
    .action(async (pipeline: string, options: StartOptions) => {
      if (given.provider && given.noProvider) {
        throw usage('--no-provider cannot be combined with --provider');
      }
      const queued = (await withDuplicateHint(() =>
        call(context(), 'run', startParams(pipeline, options)),
      )) as RunQueued;
      output(options.json, formatRunQueued(queued, activeStyle), queued);
    });
}
