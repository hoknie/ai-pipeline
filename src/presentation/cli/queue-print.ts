import type { Command } from 'commander';

import { formatQueue, formatQueues, type Style } from '../format/index.ts';
import { repositoryArgument } from '../ipc/client/index.ts';
import type { GlobalQueueView, QueueView, RepositoryView } from '../ipc/contract/index.ts';

import type { QueueKit } from './commands/queue.ts';
import { call, type Context } from './context.ts';
import { usage } from './io.ts';
import { addAuthorOptions, authorParameter, type AuthorOptions } from './options.ts';

/** Prints the queue; the registry names the projects of predecessors from other projects. */
export async function printQueue(
  json: boolean | undefined,
  view: QueueView | GlobalQueueView,
  ctx: Context,
  style: Style,
  output: (json: boolean | undefined, text: string, data: unknown) => void,
  repoGiven = false,
): Promise<void> {
  if (view.scope === 'global' && repoGiven) {
    ctx.io.stderr('aip: warning: queue scope is global: --repo is ignored\n');
  }
  const foreign = view.items.some((item) =>
    item.after.some(
      (dependency) =>
        dependency.repository !== null &&
        dependency.repository !== ('repository' in view ? view.repository : null),
    ),
  );
  const projects =
    (foreign || view.scope === 'global') && !json
      ? ((await call(ctx, 'repositories', {})) as RepositoryView[])
      : [];
  output(json, formatQueue(view, style, projects), view);
}

/** The commands for which `--repo` means nothing in the global mode. */
const REPO_IGNORED_BY = new Set(['list', 'start', 'pause', 'parallel', 'settings']);

/** Remembers whether such a command of `queue` got `--repo` by hand; in the global mode it is ignored. */
export function watchRepo(queue: Command): () => boolean {
  let given = false;
  queue.hook('preAction', (_parent, action) => {
    given = REPO_IGNORED_BY.has(action.name()) && action.getOptionValueSource('repo') === 'cli';
  });
  return () => given;
}

/** `aip queue list`: the queue of a repository, or with `--all` of every enabled project. */
interface ListOptions extends AuthorOptions {
  repo: string;
  json?: boolean;
  all?: boolean;
}

export function addList(kit: QueueKit): void {
  const { examples, context, showQueue, queue, common, output, activeStyle } = kit;
  addAuthorOptions(
    common(queue.command('list').description('Show the queue of the repository')).option(
      '--all',
      'show the queues of all enabled projects',
    ),
  )
    .addHelpText(
      'after',
      examples([
        'aip queue list',
        'aip queue list --json',
        'aip queue list --all',
        'aip queue list --mine',
      ]),
    )
    .action(async (options: ListOptions, command: Command) => {
      const filter = await authorParameter(context(), options);
      if (options.all) {
        if (filter.author !== undefined)
          throw usage('--all cannot be combined with --mine or --author');
        if (command.getOptionValueSource('repo') !== 'default') {
          throw usage('--all cannot be combined with --repo');
        }
        const views = (await call(context(), 'queues', {})) as QueueView[];
        const registry =
          views.length === 0 || options.json
            ? []
            : ((await call(context(), 'repositories', {})) as RepositoryView[]);
        output(options.json, formatQueues(views, registry, activeStyle), views);
        return;
      }
      await showQueue(
        options.json,
        (await call(context(), 'queue', {
          repository: repositoryArgument(options.repo),
          ...filter,
        })) as QueueView | GlobalQueueView,
      );
    });
}
