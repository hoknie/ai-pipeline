import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Command } from 'commander';
import { parse as parseYaml } from 'yaml';

import {
  configPaths,
  loadWebSettings,
  lockPath,
  socketPath,
  stateDirectoryFromEnvironment,
} from '../config/index.ts';
import { AlreadyRunning, startDaemon } from '../daemon/index.ts';
import { createHostServer, createWorkerServer } from '../mcp/index.ts';
import {
  daemonMismatchMessage,
  ensureDaemon,
  formatApply,
  formatGroup,
  formatQueue,
  formatRepositories,
  formatRun,
  formatRunCreated,
  formatRunQueued,
  formatRunList,
  formatTagLabels,
  formatTagList,
  filterByTags,
  TAG_COLORS,
  plainStyle,
  proposedGroupSchema,
  request,
  subscribe,
  type ApplyResult,
  type DaemonCheck,
  type GroupView,
  type Method,
  type ParamsOf,
  type QueueView,
  type RepositoryView,
  type RunCreated,
  type RunQueued,
  type RunView,
  type Style,
  type TagView,
} from '../protocol/index.ts';

import { examples as renderExamples, HELP_GROUPS } from './help.ts';
import { checkConfig } from './config-check.ts';
import { cleanRun, cleanableRuns, formatCleanable } from './clean.ts';
import { VERSION } from './version.ts';
import { latestRepository } from './web/default-repository.ts';
import { startDaemonPanel } from './web/daemon-panel.ts';
import { assertLoopbackHost, startWebServer, webTokenFromEnv } from './web/server.ts';
import { readPanelState } from './web/state.ts';
import { watch } from './watch.ts';

export interface Context {
  stateDirectory: string;
  socket: string;
  entry: string[];
  style: Style;
}

export function context(): Context {
  const directory = stateDirectoryFromEnvironment();
  const script = process.argv[1] ?? '';
  return {
    stateDirectory: directory,
    socket: socketPath(directory),
    entry: [process.execPath, script],
    style: activeStyle,
  };
}

export async function call<M extends Method>(
  ctx: Context,
  method: M,
  params: ParamsOf<M>,
): Promise<unknown> {
  await daemon(ctx);
  return request(ctx.socket, method, params);
}

const warned = new Set<string>();

/**
 * Starts the daemon when none runs and replaces an older idle one; a daemon of another build
 * that keeps running is reported on stderr, once per process.
 */
export async function daemon(ctx: Context, client = 'aip'): Promise<DaemonCheck> {
  const check = await ensureDaemon(ctx.socket, ctx.entry, {
    logPath: join(ctx.stateDirectory, 'daemon.log'),
    lockPath: lockPath(ctx.stateDirectory),
  });
  const message = daemonMismatchMessage(check, client);
  if (message && !warned.has(message)) {
    warned.add(message);
    process.stderr.write(`aip: warning: ${message}\n`);
  }
  return check;
}

function print(value: string): void {
  process.stdout.write(`${value}\n`);
}

function output(json: boolean | undefined, text: string, data: unknown): void {
  print(json ? JSON.stringify(data, null, 2) : text);
}

let activeStyle: Style = plainStyle;

function examples(lines: string[]): string {
  return renderExamples(lines, activeStyle);
}

function readGroups(file: string) {
  return proposedGroupSchema
    .array()
    .min(1)
    .parse(parseYaml(readFileSync(file, 'utf8')));
}

/** Collects a repeatable option into a list. */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

interface QueueTaskOptions {
  tag?: string[];
  task?: string;
  groups?: string;
  title?: string;
  autoDeliver?: boolean;
  repo: string;
  json?: boolean;
}

function showQueue(json: boolean | undefined, view: QueueView): void {
  output(json, formatQueue(view, activeStyle), view);
}

function registerQueue(program: Command): void {
  const queue = program
    .command('queue')
    .description('Tasks waiting for a start: add, reorder and run them one by one or in parallel');
  const taskOptions = (command: Command): Command =>
    command
      .option('-t, --task <text>', 'one task; the workflow may split it into groups')
      .option('-g, --groups <file>', 'YAML or JSON file with a list of { title, task }')
      .option('--title <text>', 'title of the run (at most 60 characters)')
      .option(
        '--auto-deliver',
        'deliver the merged groups automatically, whatever delivery.auto says',
      )
      .option('--no-auto-deliver', 'leave the merged groups for `aip apply`')
      .option('--tag <name>', 'tag of the task; repeat for several', collect);
  const common = (command: Command): Command =>
    command.option('-r, --repo <path>', 'repository path', '.').option('--json', 'print JSON');

  common(queue.command('list').description('Show the queue of the repository'))
    .addHelpText('after', examples(['aip queue list', 'aip queue list --json']))
    .action(async (options: { repo: string; json?: boolean }) => {
      showQueue(
        options.json,
        (await call(context(), 'queue', { repository: resolve(options.repo) })) as QueueView,
      );
    });

  common(
    taskOptions(
      queue
        .command('add')
        .description('Add a task to the end of the queue; it does not start the queue')
        .argument('<workflow>', 'workflow id from swarm.yaml'),
    ),
  )
    .addHelpText(
      'after',
      examples([
        'aip queue add feature --task "Add a login form"',
        'aip queue add feature -g g.yaml',
      ]),
    )
    .action(async (workflow: string, options: QueueTaskOptions) => {
      if ((options.task === undefined) === (options.groups === undefined)) {
        throw new Error('pass exactly one of --task and --groups');
      }
      const view = (await call(context(), 'queue_add', {
        repository: resolve(options.repo),
        workflow,
        ...(options.task !== undefined ? { task: options.task } : {}),
        ...(options.groups !== undefined ? { groups: readGroups(options.groups) } : {}),
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.autoDeliver !== undefined ? { autoDeliver: options.autoDeliver } : {}),
        ...(options.tag !== undefined ? { tags: options.tag } : {}),
      })) as QueueView & { item: string };
      if (!options.json) print(`Added ${view.item}.`);
      showQueue(options.json, view);
    });

  common(
    taskOptions(
      queue
        .command('edit')
        .description('Change a waiting task')
        .argument('<item>', 'item id from `aip queue list`')
        .option('-w, --workflow <id>', 'new workflow id')
        .option('--default-auto-deliver', 'follow delivery.auto of the configuration again')
        .option('--no-tags', 'remove all tags of the task'),
    ),
  )
    .addHelpText(
      'after',
      examples(['aip queue edit 1 --task "New wording"', 'aip queue edit 1 --workflow feature']),
    )
    .action(
      async (
        item: string,
        options: QueueTaskOptions & {
          workflow?: string;
          defaultAutoDeliver?: boolean;
          tags?: boolean;
        },
      ) => {
        if (options.tags === false && options.tag !== undefined) {
          throw new Error('--no-tags cannot be combined with --tag');
        }
        if (options.task !== undefined && options.groups !== undefined) {
          throw new Error('pass at most one of --task and --groups');
        }
        if (options.defaultAutoDeliver && options.autoDeliver !== undefined) {
          throw new Error('--default-auto-deliver cannot be combined with --auto-deliver');
        }
        showQueue(
          options.json,
          (await call(context(), 'queue_edit', {
            repository: resolve(options.repo),
            item,
            ...(options.workflow !== undefined ? { workflow: options.workflow } : {}),
            ...(options.task !== undefined ? { task: options.task } : {}),
            ...(options.groups !== undefined ? { groups: readGroups(options.groups) } : {}),
            ...(options.title !== undefined ? { title: options.title } : {}),
            ...(options.defaultAutoDeliver
              ? { autoDeliver: null }
              : options.autoDeliver !== undefined
                ? { autoDeliver: options.autoDeliver }
                : {}),
            ...(options.tags === false ? { tags: [] } : {}),
            ...(options.tag !== undefined ? { tags: options.tag } : {}),
          })) as QueueView,
        );
      },
    );

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
          repository: resolve(options.repo),
          item,
        })) as QueueView,
      );
    });

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
          repository: resolve(options.repo),
          item,
          position: Number(position),
        })) as QueueView,
      );
    });

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
          repository: resolve(options.repo),
          ...(options.parallel !== undefined ? { parallel: Number(options.parallel) } : {}),
        })) as QueueView,
      );
    });

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
          repository: resolve(options.repo),
          parallel: Number(n),
        })) as QueueView,
      );
    });

  common(queue.command('pause').description('Stop taking tasks; runs already started keep going'))
    .addHelpText('after', examples(['aip queue pause']))
    .action(async (options: { repo: string; json?: boolean }) => {
      showQueue(
        options.json,
        (await call(context(), 'queue_pause', { repository: resolve(options.repo) })) as QueueView,
      );
    });

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
      const repository = resolve(options.repo);
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

function registerRepositories(program: Command): void {
  const repo = program
    .command('repo')
    .description('Repositories the daemon knows: list, add and remove them');
  const show = (json: boolean | undefined, views: RepositoryView[]): void => {
    output(json, formatRepositories(views, activeStyle), views);
  };

  repo
    .command('list')
    .description(
      'Show known repositories with their unfinished runs, waiting runs and queued tasks',
    )
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip repo list', 'aip repo list --json']))
    .action(async (options: { json?: boolean }) => {
      show(options.json, (await call(context(), 'repositories', {})) as RepositoryView[]);
    });

  repo
    .command('add')
    .description('Add a git repository to the list; a subdirectory resolves to its root')
    .argument('<path>', 'path inside a git repository')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip repo add ~/projects/app']))
    .action(async (path: string, options: { json?: boolean }) => {
      show(
        options.json,
        (await call(context(), 'repository_add', { path: resolve(path) })) as RepositoryView[],
      );
    });

  repo
    .command('remove')
    .description(
      'Remove a repository from the list; refused while it has unfinished runs or queued tasks. ' +
        'It returns on the next request that names it',
    )
    .argument('<path>', 'repository path')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip repo remove ~/projects/old-app']))
    .action(async (path: string, options: { json?: boolean }) => {
      show(
        options.json,
        (await call(context(), 'repository_remove', { path: resolve(path) })) as RepositoryView[],
      );
    });
}

function registerTag(program: Command): void {
  const tag = program
    .command('tag')
    .description(
      `Tags of tasks and runs, one catalog for all repositories. Colors: ${TAG_COLORS.join(', ')}`,
    );
  const show = (json: boolean | undefined, tags: TagView[]): void => {
    output(json, formatTagList(tags, activeStyle), tags);
  };

  tag
    .command('list')
    .description('Show the tags')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip tag list']))
    .action(async (options: { json?: boolean }) => {
      show(options.json, (await call(context(), 'tags', {})) as TagView[]);
    });

  tag
    .command('add')
    .description('Create a tag (name up to 30 characters, unique ignoring case)')
    .argument('<name>', 'tag name')
    .option('--color <color>', `one of: ${TAG_COLORS.join(', ')}`)
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip tag add auth --color blue']))
    .action(async (name: string, options: { color?: string; json?: boolean }) => {
      show(
        options.json,
        (await call(context(), 'tag_add', {
          name,
          ...(options.color !== undefined ? { color: options.color } : {}),
        })) as TagView[],
      );
    });

  tag
    .command('edit')
    .description('Rename a tag or change its color; tasks and runs keep the tag')
    .argument('<name>', 'tag name')
    .option('--name <new>', 'new name')
    .option('--color <color>', `one of: ${TAG_COLORS.join(', ')}`)
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip tag edit auth --name login --color teal']))
    .action(async (name: string, options: { name?: string; color?: string; json?: boolean }) => {
      if (options.name === undefined && options.color === undefined) {
        throw new Error('pass --name or --color');
      }
      show(
        options.json,
        (await call(context(), 'tag_edit', {
          tag: name,
          ...(options.name !== undefined ? { name: options.name } : {}),
          ...(options.color !== undefined ? { color: options.color } : {}),
        })) as TagView[],
      );
    });

  tag
    .command('remove')
    .description('Delete a tag and take it off every task and run')
    .argument('<name>', 'tag name')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip tag remove auth']))
    .action(async (name: string, options: { json?: boolean }) => {
      show(options.json, (await call(context(), 'tag_remove', { tag: name })) as TagView[]);
    });
}

function registerRun(program: Command): void {
  const run = program
    .command('run')
    .description('Start, follow, deliver and clean up runs of a workflow');

  run
    .command('start')
    .description(
      'Queue a workflow task of the aip/ configuration: it goes to the end of the repository queue, a stopped queue is started',
    )
    .argument('<workflow>', 'workflow id from the aip/ configuration')
    .option('-t, --task <text>', 'one task; the workflow may split it into groups')
    .option('-g, --groups <file>', 'YAML or JSON file with a list of { title, task }')
    .option('-r, --repo <path>', 'repository path', '.')
    .option(
      '--title <text>',
      'title of the run (at most 60 characters); otherwise a model names it',
    )
    .option(
      '--auto-deliver',
      'deliver the merged groups automatically, whatever delivery.auto says',
    )
    .option('--no-auto-deliver', 'leave the merged groups for `aip apply`')
    .option('--tag <name>', 'tag of the task; repeat for several', collect)
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip run start feature --no-auto-deliver --task "Add a login form"',
        'aip run start feature --task "Add a login form"',
        'aip run start feature --title "Login form" --task "Add a login form with OAuth"',
        'aip run start feature --groups groups.yaml --repo ~/projects/app',
      ]),
    )
    .action(
      async (
        workflow: string,
        options: {
          task?: string;
          groups?: string;
          repo: string;
          title?: string;
          autoDeliver?: boolean;
          tag?: string[];
          json?: boolean;
        },
      ) => {
        if ((options.task === undefined) === (options.groups === undefined)) {
          throw new Error('pass exactly one of --task and --groups');
        }
        const groups = options.groups ? readGroups(options.groups) : undefined;
        const queued = (await call(context(), 'run', {
          repository: resolve(options.repo),
          workflow,
          ...(options.task !== undefined ? { task: options.task } : {}),
          ...(groups ? { groups } : {}),
          ...(options.title !== undefined ? { title: options.title } : {}),
          ...(options.autoDeliver !== undefined ? { autoDeliver: options.autoDeliver } : {}),
          ...(options.tag !== undefined ? { tags: options.tag } : {}),
        })) as RunQueued;
        output(options.json, formatRunQueued(queued, activeStyle), queued);
      },
    );

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

  const showTags = (view: RunView, json: boolean | undefined): void => {
    const labels = formatTagLabels(view.tags, activeStyle);
    output(json, `Tags of run ${view.id}: ${labels || 'none'}`, view);
  };

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

  run
    .command('watch')
    .description('Follow a run until it finishes')
    .argument('[run-id]', 'run id; defaults to the latest active run')
    .addHelpText('after', examples(['aip run watch', 'aip run watch 0mh3k2ab1x9z']))
    .action(async (runId: string | undefined) => {
      await watch(context(), runId);
    });

  run
    .command('cancel')
    .description('Cancel a whole run')
    .argument('<run-id>', 'run id')
    .addHelpText('after', examples(['aip run cancel 0mh3k2ab1x9z']))
    .action(async (runId: string) => {
      const view = (await call(context(), 'cancel', { runId })) as RunView;
      print(formatRun(view, Date.now(), activeStyle));
    });

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
          process.exitCode = 1;
      },
    );

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
        if (options.all) throw new Error('--all needs a <run-id>');
        const runs = await cleanableRuns(context());
        output(options.json, formatCleanable(runs, activeStyle), runs);
        return;
      }
      if (options.json) throw new Error('--json lists runs and cannot be used with a <run-id>');
      for (const removed of await cleanRun(context(), runId, options.all ?? false))
        print(`removed ${removed}`);
    });
}

function registerGroup(program: Command): void {
  const group = program
    .command('group')
    .description('Inspect and steer one group of a run: attempts, retry, cancel, answer');

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

  group
    .command('retry')
    .description(
      'Retry a failed or cancelled group from where it stopped, or its merge after a conflict',
    )
    .argument('<run-id>', 'run id')
    .argument('<group>', 'group slug')
    .addHelpText('after', examples(['aip group retry 0mh3k2ab1x9z login']))
    .action(async (runId: string, name: string) => {
      print(
        formatRun(
          (await call(context(), 'retry', { runId, group: name })) as RunView,
          Date.now(),
          activeStyle,
        ),
      );
    });

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

function openBrowser(url: string): void {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(opener, args, { stdio: 'ignore', detached: true })
    .on('error', () => {
      process.stderr.write('aip web: could not open the browser; use the URL above\n');
    })
    .unref();
}

export function registerCommands(program: Command, style: Style = plainStyle): void {
  activeStyle = style;
  const [runs, queueGroup, dashboards, setup, plumbing] = HELP_GROUPS;
  program.commandsGroup(runs!.heading);
  registerRun(program);
  registerGroup(program);
  program.commandsGroup(queueGroup!.heading);
  registerQueue(program);
  registerRepositories(program);
  registerTag(program);
  program.commandsGroup(dashboards!.heading);
  program
    .command('web')
    .description(
      'Serve a local web dashboard for runs (bound to 127.0.0.1, protected by a token unless web.auth is none)',
    )
    .option('-p, --port <port>', 'port to listen on (default: web.port, 7341)')
    .option('--host <host>', 'loopback address: 127.0.0.1, localhost or ::1 (default: web.host)')
    .option('--open', 'open the dashboard in the default browser')
    .addHelpText(
      'after',
      '\nThe daemon serves the dashboard itself (web.autostart); then `aip web` prints its link and exits.',
    )
    .addHelpText('after', examples(['aip web', 'aip web --port 8080 --open']))
    .action(async (options: { port?: string; host?: string; open?: boolean }) => {
      const settings = loadWebSettings(
        configPaths(process.cwd(), process.env.XDG_CONFIG_HOME, process.env.HOME),
      );
      const host = options.host ?? settings.host;
      const port = options.port === undefined ? settings.port : Number(options.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw new Error('--port must be an integer from 0 to 65535');
      assertLoopbackHost(host);
      let token: string | undefined;
      if (settings.auth === 'none') {
        if (process.env.AIP_WEB_TOKEN)
          process.stderr.write('aip web: AIP_WEB_TOKEN is ignored: web.auth is none\n');
      } else {
        token = webTokenFromEnv(process.env);
      }
      const ctx = context();
      await daemon(ctx, 'aip web');
      const autostart =
        settings.autostart &&
        process.env.AIP_WEB_AUTOSTART !== '0' &&
        process.env.AIP_WEB_AUTOSTART !== 'false';
      let url: string | undefined;
      if (autostart && host === settings.host && port === settings.port) {
        const deadline = Date.now() + 5000;
        for (;;) {
          const state = readPanelState(ctx.stateDirectory);
          if (state !== null && state.host === host && state.port === port) {
            print(`aip web: ${state.url}`);
            print(`aip web: served by the aip daemon (pid ${state.pid})`);
            url = state.url;
            break;
          }
          if (Date.now() >= deadline) break;
          await new Promise((done) => setTimeout(done, 100));
        }
      }
      if (url !== undefined) {
        if (options.open) openBrowser(url);
        return;
      }
      let web: Awaited<ReturnType<typeof startWebServer>>;
      try {
        web = await startWebServer({
          socket: ctx.socket,
          ensureDaemon: () => daemon(ctx, 'aip web'),
          host,
          port,
          auth: settings.auth,
          ...(token === undefined ? {} : { token }),
          // The panel works with the daemon's registry only, never with the launch directory.
          defaultRepository: () => latestRepository(ctx.socket),
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE')
          throw new Error(
            `port ${host}:${port} is already in use, maybe by another aip web: open that panel and choose the repository there, or pass --port <n>`,
          );
        throw error;
      }
      print(`aip web: ${web.url}`);
      print('Press Ctrl+C to stop.');
      if (options.open) openBrowser(web.url);
      await new Promise<void>((resolve) => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
      await web.close();
    });

  program
    .command('events')
    .description('Stream changes of runs as JSON lines: a snapshot first, then one line per change')
    .option('--json', 'print JSON lines (the only format)')
    .addHelpText('after', examples(['aip events --json']))
    .action(async () => {
      const ctx = context();
      await daemon(ctx);
      let interrupted = false;
      process.once('SIGINT', () => {
        interrupted = true;
        process.exit(0);
      });
      await subscribe(ctx.socket, (line) => process.stdout.write(`${line}\n`));
      if (!interrupted) {
        process.stderr.write('aip events: the daemon closed the stream\n');
        process.exitCode = 1;
      }
    });

  program.commandsGroup(setup!.heading);
  const config = program.command('config').description('Inspect the aip/ configuration');
  config
    .command('check')
    .description(
      'Validate the aip/ configuration and print the merged configuration and agent CLI versions',
    )
    .option('-r, --repo <path>', 'repository path', '.')
    .addHelpText('after', examples(['aip config check', 'aip config check --repo ~/projects/app']))
    .action(async (options: { repo: string }) => {
      process.exitCode = await checkConfig(resolve(options.repo));
    });

  program
    .command('version')
    .description('Print the aip version (same as --version)')
    .option('--json', 'print JSON on one line')
    .addHelpText('after', examples(['aip version', 'aip version --json']))
    .action((options: { json?: boolean }) => {
      print(options.json ? JSON.stringify({ version: VERSION }) : VERSION);
    });

  program.helpCommand('help [command]', 'Show help for a command');

  program.commandsGroup(plumbing!.heading);
  program
    .command('daemon')
    .description('Run the aip daemon in the foreground (clients start it automatically)')
    .addHelpText('after', examples(['aip daemon']))
    .action(async () => {
      const ctx = context();
      try {
        const running = await startDaemon({ stateDirectory: ctx.stateDirectory, entry: ctx.entry });
        const stop = () => void running.close();
        process.once('SIGTERM', stop);
        process.once('SIGINT', stop);
        print(`aip daemon listening on ${ctx.socket} (pid ${process.pid})`);
        const panel = await startDaemonPanel({
          stateDirectory: ctx.stateDirectory,
          socket: ctx.socket,
        });
        if (panel !== null) print(`aip web: ${panel.url}`);
        await running.closed;
        await panel?.close();
      } catch (error) {
        if (error instanceof AlreadyRunning) {
          process.stderr.write(`aip daemon: ${error.message}\n`);
          process.exitCode = 1;
          return;
        }
        throw error;
      }
    });

  program
    .command('mcp')
    .description('Run the MCP server for Claude Code or OpenCode over stdio')
    .option('--worker <token>', 'serve swarm_report for one attempt (started by the daemon)')
    .option('--socket <path>', 'daemon socket (worker mode)')
    .option('--split', 'also serve swarm_split (split step)')
    .option('--queue', 'also serve swarm_queue_add (specialist with queue: true)')
    .addHelpText('after', examples(['aip mcp', 'aip mcp --queue']))
    .action(
      async (options: { worker?: string; socket?: string; split?: boolean; queue?: boolean }) => {
        if (options.worker) {
          const socket = options.socket;
          if (!socket) throw new Error('--worker needs --socket');
          const server = createWorkerServer({
            token: options.worker,
            split: options.split ?? false,
            queue: options.queue ?? false,
            send: (method, params) => request(socket, method as Method, params as never),
          });
          await server.connect(new StdioServerTransport());
          return;
        }
        const ctx = context();
        const server = createHostServer({
          cwd: process.cwd(),
          send: (method, params) => call(ctx, method as Method, params as never),
        });
        await server.connect(new StdioServerTransport());
      },
    );
}
