import { formatAddedToProjects } from '../format/index.ts';
import { repositoryArgument } from '../ipc/client/index.ts';
import type { AddedToProjectView, QueueView } from '../ipc/contract/index.ts';
import { call } from './context.ts';
import { usage } from './io.ts';
import { linkInputsOf } from './links.ts';
import {
  attachmentSources,
  collect,
  parseDeliveryMode,
  parseNotes,
  readGroups,
  type QueueTaskOptions,
} from './options.ts';
import type { QueueKit } from './commands/queue.ts';

/** The options of `aip queue add`: `--repo` may repeat, the flags after it need several. */
type AddOptions = Omit<QueueTaskOptions, 'repo'> & {
  repo?: string[];
  tagAll?: string;
  chain?: boolean;
  note?: string[];
  link?: string[];
};

/** The flags that fit only one project or only several; a wrong mix is a usage error. */
function checkRepos(options: AddOptions, several: boolean): void {
  if (
    !several &&
    (options.tagAll !== undefined || options.chain === true || options.note !== undefined)
  ) {
    throw usage('--tag-all, --chain and --note need several --repo');
  }
  if (several && (options.tag !== undefined || typeof options.parent === 'string')) {
    throw usage('--tag and --parent take one --repo; use --tag-all for several projects');
  }
  if (several && (options.groups !== undefined || options.attach !== undefined)) {
    throw usage('groups and attachments are not supported for several projects');
  }
}

/** The fields of the task that one project and several projects take alike. */
function taskFields(pipeline: string, options: AddOptions) {
  const deliveryMode = parseDeliveryMode(options.deliveryMode);
  const links = linkInputsOf(options, {
    after: options.after !== undefined,
    parent: typeof options.parent === 'string',
  });
  return {
    pipeline,
    ...(options.task !== undefined ? { task: options.task } : {}),
    ...(options.groups !== undefined ? { groups: readGroups(options.groups) } : {}),
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.autoDeliver !== undefined ? { autoDeliver: options.autoDeliver } : {}),
    ...(deliveryMode !== undefined ? { deliveryMode } : {}),
    ...(options.variant !== undefined ? { variant: options.variant } : {}),
    ...(typeof options.provider === 'string' ? { provider: options.provider } : {}),
    ...(options.skip !== undefined ? { skip: options.skip } : {}),
    ...(options.after !== undefined ? { after: options.after } : {}),
    ...(links !== undefined ? { links } : {}),
    ...(options.attach !== undefined ? { attachments: attachmentSources(options.attach) } : {}),
    ...(options.postpone ? { postponed: true } : {}),
  };
}

export function addAdd(kit: QueueKit): void {
  const { print, output, examples, context, showQueue, queue, taskOptions } = kit;
  taskOptions(
    queue
      .command('add')
      .description('Add a task to the end of the queue; it does not start the queue')
      .argument('<pipeline>', 'pipeline id from swarm.yaml')
      .option('--postpone', 'postpone the task: a running queue does not take it'),
  )
    .option(
      '-r, --repo <path>',
      'repository path or project slug; repeat to add the task to several projects (default: .)',
      collect,
    )
    .option('--tag-all <name>', 'with several --repo: the tag every project gets from its catalog')
    .option('--chain', 'with several --repo: the task of each project waits for the previous one')
    .option(
      '--note <project=text>',
      'with several --repo: an addition to the task text for one project; repeat for several',
      collect,
    )
    .option(
      '--link <kind>:<task>',
      'link of the task, e.g. related:#12; repeat for several',
      collect,
    )
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip queue add feature --task "Add a login form"',
        'aip queue add feature -g g.yaml',
        'aip queue add feature --task "Fix the typo" --skip review --skip qa',
        'aip queue add feature --task "Add the API" --after q1',
        'aip queue add feature --task "Related" --link related:#12',
        'aip queue add feature --task "Fix the layout" --attach shot.png --attach spec.pdf',
        'aip queue add feature --task "Follow-up" --parent 115',
        'aip queue add feature --task "Later" --postpone',
        'aip queue add feature --task "Email field" --repo lib --repo web --chain --tag-all email',
      ]),
    )
    .action(async (pipeline: string, options: AddOptions) => {
      if ((options.task === undefined) === (options.groups === undefined)) {
        throw usage('pass exactly one of --task and --groups');
      }
      const repos = options.repo ?? ['.'];
      const several = repos.length > 1;
      checkRepos(options, several);
      const task = taskFields(pipeline, options);
      if (several) {
        const parsed = parseNotes(options.note);
        const notes =
          parsed === undefined
            ? undefined
            : Object.fromEntries(
                Object.entries(parsed).map(([key, text]) => [repositoryArgument(key), text]),
              );
        const added = (await call(context(), 'queue_add_projects', {
          ...task,
          task: options.task ?? '',
          repositories: repos.map((repo) => repositoryArgument(repo)),
          ...(notes !== undefined ? { notes } : {}),
          ...(options.tagAll !== undefined ? { tag: options.tagAll } : {}),
          ...(options.chain === true ? { chain: true } : {}),
        })) as AddedToProjectView[];
        output(options.json, formatAddedToProjects(added, kit.activeStyle), added);
        return;
      }
      const view = (await call(context(), 'queue_add', {
        ...task,
        repository: repositoryArgument(repos[0] ?? '.'),
        ...(options.tag !== undefined ? { tags: options.tag } : {}),
        ...(typeof options.parent === 'string' ? { parent: options.parent } : {}),
      })) as QueueView & { item: string };
      if (!options.json) print(`Added ${view.item}.`);
      await showQueue(options.json, view);
    });
}
