import type { Command } from 'commander';

import { TAG_COLORS } from '../../../feature/tags/types/index.ts';
import { formatTagList, type Style } from '../../format/index.ts';
import { repositoryArgument } from '../../ipc/client/index.ts';
import type { TagView } from '../../ipc/contract/index.ts';
import { bind, call } from '../context.ts';
import { usage, type CliIo } from '../io.ts';

function tagKit(program: Command, io: CliIo, style: Style) {
  const { print, output, examples, context, activeStyle } = bind(io, style);
  const tag = program
    .command('tag')
    .description(
      `Tags of tasks and runs; every repository has its own catalog. Colors: ${TAG_COLORS.join(', ')}`,
    );
  const show = (json: boolean | undefined, tags: TagView[]): void => {
    output(json, formatTagList(tags, activeStyle), tags);
  };
  return { print, output, examples, context, activeStyle, io, tag, show };
}

type TagKit = ReturnType<typeof tagKit>;

function addList(kit: TagKit): void {
  const { print, examples, context, tag, show } = kit;
  tag
    .command('list')
    .description('Show the tags of the repository')
    .option('-r, --repo <path>', 'repository path or project slug', '.')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip tag list']))
    .action(async (options: { repo: string; json?: boolean }) => {
      show(
        options.json,
        (await call(context(), 'tags', {
          repository: repositoryArgument(options.repo),
        })) as TagView[],
      );
    });
}

function addAdd(kit: TagKit): void {
  const { print, examples, context, tag, show } = kit;
  tag
    .command('add')
    .description('Create a tag (name up to 30 characters, unique ignoring case)')
    .argument('<name>', 'tag name')
    .option('--color <color>', `one of: ${TAG_COLORS.join(', ')}`)
    .option('-r, --repo <path>', 'repository path or project slug', '.')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip tag add auth --color blue']))
    .action(async (name: string, options: { color?: string; repo: string; json?: boolean }) => {
      show(
        options.json,
        (await call(context(), 'tag_add', {
          repository: repositoryArgument(options.repo),
          name,
          ...(options.color !== undefined ? { color: options.color } : {}),
        })) as TagView[],
      );
    });
}

function addEdit(kit: TagKit): void {
  const { print, examples, context, tag, show } = kit;
  tag
    .command('edit')
    .description('Rename a tag or change its color; tasks and runs keep the tag')
    .argument('<name>', 'tag name')
    .option('--name <new>', 'new name')
    .option('--color <color>', `one of: ${TAG_COLORS.join(', ')}`)
    .option('-r, --repo <path>', 'repository path or project slug', '.')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip tag edit auth --name login --color teal']))
    .action(
      async (
        name: string,
        options: { name?: string; color?: string; repo: string; json?: boolean },
      ) => {
        if (options.name === undefined && options.color === undefined) {
          throw usage('pass --name or --color');
        }
        show(
          options.json,
          (await call(context(), 'tag_edit', {
            repository: repositoryArgument(options.repo),
            tag: name,
            ...(options.name !== undefined ? { name: options.name } : {}),
            ...(options.color !== undefined ? { color: options.color } : {}),
          })) as TagView[],
        );
      },
    );
}

function addRemove(kit: TagKit): void {
  const { print, examples, context, tag, show } = kit;
  tag
    .command('remove')
    .description('Delete a tag and take it off every task and run of the repository')
    .argument('<name>', 'tag name')
    .option('-r, --repo <path>', 'repository path or project slug', '.')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip tag remove auth']))
    .action(async (name: string, options: { repo: string; json?: boolean }) => {
      show(
        options.json,
        (await call(context(), 'tag_remove', {
          repository: repositoryArgument(options.repo),
          tag: name,
        })) as TagView[],
      );
    });
}

export function registerTag(program: Command, io: CliIo, style: Style): void {
  const kit = tagKit(program, io, style);
  for (const add of [addList, addAdd, addEdit, addRemove]) add(kit);
}
