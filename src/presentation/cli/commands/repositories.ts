import { resolve } from 'node:path';

import type { Command } from 'commander';

import { formatRepositories, type Style } from '../../format/index.ts';
import type { RepositoryView } from '../../ipc/contract/index.ts';
import { bind, call } from '../context.ts';
import type { CliIo } from '../io.ts';

function repositoriesKit(program: Command, io: CliIo, style: Style) {
  const { print, output, examples, context, activeStyle } = bind(io, style);
  const repo = program
    .command('repo')
    .description('Repositories the daemon knows: list, add and remove them');
  const show = (json: boolean | undefined, views: RepositoryView[]): void => {
    output(json, formatRepositories(views, activeStyle), views);
  };
  return { print, output, examples, context, activeStyle, io, repo, show };
}

type RepoKit = ReturnType<typeof repositoriesKit>;

function addList(kit: RepoKit): void {
  const { print, examples, context, repo, show } = kit;
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
}

function addAdd(kit: RepoKit): void {
  const { print, examples, context, repo, show } = kit;
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
}

function addRemove(kit: RepoKit): void {
  const { print, examples, context, repo, show } = kit;
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

export function registerRepositories(program: Command, io: CliIo, style: Style): void {
  const kit = repositoriesKit(program, io, style);
  for (const add of [addList, addAdd, addRemove]) add(kit);
}
