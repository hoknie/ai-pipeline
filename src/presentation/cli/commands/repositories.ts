import { resolve } from 'node:path';

import type { Command } from 'commander';

import { PROJECT_COLORS } from '../../../feature/repos/types/index.ts';
import { formatRepositories, type Style } from '../../format/index.ts';
import { repositoryArgument } from '../../ipc/client/index.ts';
import type { RepositoryView } from '../../ipc/contract/index.ts';
import { bind, call } from '../context.ts';
import { usage, type CliIo } from '../io.ts';

function repositoriesKit(program: Command, io: CliIo, style: Style) {
  const { print, output, examples, context, activeStyle } = bind(io, style);
  const repo = program
    .command('repo')
    .description('Projects the daemon knows: list, add, edit, move and remove them');
  const show = (json: boolean | undefined, views: RepositoryView[]): void => {
    output(json, formatRepositories(views, activeStyle), views);
  };
  return { print, output, examples, context, activeStyle, io, repo, show };
}

type RepoKit = ReturnType<typeof repositoriesKit>;

const COLORS = PROJECT_COLORS.join(', ');

function addList(kit: RepoKit): void {
  const { examples, context, repo, show } = kit;
  repo
    .command('list')
    .description(
      'Show known projects: slug, name, path, state, unfinished runs, waiting runs and queued tasks',
    )
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip repo list', 'aip repo list --json']))
    .action(async (options: { json?: boolean }) => {
      show(options.json, (await call(context(), 'repositories', {})) as RepositoryView[]);
    });
}

function addAdd(kit: RepoKit): void {
  const { examples, context, repo, show } = kit;
  repo
    .command('add')
    .description('Add a git repository to the list; a subdirectory resolves to its root')
    .argument('<path>', 'path inside a git repository')
    .option('--name <name>', 'name of the project; the directory name without one')
    .option(
      '--slug <slug>',
      'short address of the project; made from the directory name without one',
    )
    .option('--color <color>', `color of the project: ${COLORS}`)
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip repo add ~/projects/app',
        'aip repo add ~/projects/app --name Shop --slug shop',
      ]),
    )
    .action(
      async (
        path: string,
        options: { name?: string; slug?: string; color?: string; json?: boolean },
      ) => {
        const { json, ...attributes } = options;
        show(
          json,
          (await call(context(), 'repository_add', {
            path: resolve(path),
            ...attributes,
          })) as RepositoryView[],
        );
      },
    );
}

interface EditOptions {
  name?: string | false;
  slug?: string;
  color?: string;
  enable?: boolean;
  disable?: boolean;
  json?: boolean;
}

/** The changes `aip repo edit` asks for; contradicting or missing flags are a usage error. */
function editChanges(options: EditOptions): Record<string, unknown> {
  if (options.enable && options.disable) throw usage('pass only one of --enable and --disable');
  const changes = {
    ...(options.name !== undefined ? { name: options.name === false ? null : options.name } : {}),
    ...(options.slug !== undefined ? { slug: options.slug } : {}),
    ...(options.color !== undefined
      ? { color: options.color === 'none' ? null : options.color }
      : {}),
    ...(options.enable ? { enabled: true } : {}),
    ...(options.disable ? { enabled: false } : {}),
  };
  if (Object.keys(changes).length === 0) {
    throw usage('pass at least one of --name, --no-name, --slug, --color, --enable, --disable');
  }
  return changes;
}

function addEdit(kit: RepoKit): void {
  const { examples, context, repo, show } = kit;
  repo
    .command('edit')
    .description(
      'Change a project: its name, slug, color, or whether it is enabled. A disabled project ' +
        'takes no new runs or tasks; its running runs go on',
    )
    .argument('<project>', 'repository path or project slug')
    .option('--name <name>', 'name of the project')
    .option('--no-name', 'drop the name: the project shows its directory name')
    .option('--slug <slug>', 'short address of the project')
    .option('--color <color>', `color of the project: ${COLORS}; none drops it`)
    .option('--enable', 'enable the project')
    .option('--disable', 'disable the project and pause its queue')
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples(['aip repo edit app --name Shop --color teal', 'aip repo edit app --disable']),
    )
    .action(async (project: string, options: EditOptions) => {
      const changes = editChanges(options);
      show(
        options.json,
        (await call(context(), 'repository_update', {
          path: repositoryArgument(project),
          ...changes,
        })) as RepositoryView[],
      );
    });
}

function addMove(kit: RepoKit): void {
  const { examples, context, repo, show } = kit;
  repo
    .command('move')
    .description(
      'Give a project a new path after its repository moved; its runs, queue and tags follow. ' +
        'Refused while it has unfinished runs or queued tasks. No files are moved',
    )
    .argument('<project>', 'repository path or project slug')
    .argument('<path>', 'path inside the git repository at its new place')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip repo move app ~/work/app']))
    .action(async (project: string, path: string, options: { json?: boolean }) => {
      show(
        options.json,
        (await call(context(), 'repository_move', {
          path: repositoryArgument(project),
          to: resolve(path),
        })) as RepositoryView[],
      );
    });
}

function addRemove(kit: RepoKit): void {
  const { examples, context, repo, show } = kit;
  repo
    .command('remove')
    .description(
      'Remove a repository from the list; refused while it has unfinished runs or queued tasks. ' +
        'It returns on the next request that names it',
    )
    .argument('<project>', 'repository path or project slug')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip repo remove ~/projects/old-app', 'aip repo remove app']))
    .action(async (project: string, options: { json?: boolean }) => {
      show(
        options.json,
        (await call(context(), 'repository_remove', {
          path: repositoryArgument(project),
        })) as RepositoryView[],
      );
    });
}

export function registerRepositories(program: Command, io: CliIo, style: Style): void {
  const kit = repositoriesKit(program, io, style);
  for (const add of [addList, addAdd, addEdit, addMove, addRemove]) add(kit);
}
