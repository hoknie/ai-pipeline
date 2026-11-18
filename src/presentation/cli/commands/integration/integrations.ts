import type { Command } from 'commander';

import { formatConnections, formatIntegrationTypes, type Style } from '../../../format/index.ts';
import { repositoryArgument } from '../../../ipc/client/index.ts';
import type { ConnectionView, IntegrationTypeView } from '../../../ipc/contract/index.ts';
import { bind, call } from '../../context.ts';
import { usage, type CliIo } from '../../io.ts';

/** The longest secret the daemon accepts, plus room for a newline. */
const STDIN_LIMIT = 16 * 1024 + 2;

function parseParams(pairs: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at < 1) throw usage('pass --param as <key>=<value>');
    params[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return params;
}

/** The secret from stdin: one trailing newline is dropped; nothing is echoed anywhere. */
async function secretFromStdin(io: CliIo): Promise<string> {
  if (io.readStdin === undefined) throw usage('this terminal cannot read a secret from stdin');
  const raw = await io.readStdin(STDIN_LIMIT);
  if (raw === null) throw usage('secret input is too long');
  const value = raw.replace(/\r?\n$/, '');
  if (value === '') throw usage('secret input is empty');
  return value;
}

function integrationKit(program: Command, io: CliIo, style: Style) {
  const { print, output, examples, context, activeStyle } = bind(io, style);
  const root = program
    .command('integration')
    .description(
      'Connections to external systems and their secrets (local, per project or shared)',
    );
  const show = (json: boolean | undefined, views: ConnectionView[]): void =>
    output(json, formatConnections(views, activeStyle), views);
  return { print, output, examples, context, activeStyle, root, show, io };
}

type Kit = ReturnType<typeof integrationKit>;

function addReadCommands(kit: Kit): void {
  const { root, examples, context, output, activeStyle, show } = kit;
  root
    .command('types')
    .description('Show the kinds built into this version')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip integration types']))
    .action(async (options: { json?: boolean }) => {
      const types = (await call(context(), 'integration_types', {})) as IntegrationTypeView[];
      output(options.json, formatIntegrationTypes(types, activeStyle), types);
    });
  root
    .command('list')
    .description('Show connections (of one project and the shared ones with --repo)')
    .option('-r, --repo <project>', 'project path or slug')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip integration list', 'aip integration list --repo shop']))
    .action(async (options: { repo?: string; json?: boolean }) => {
      const repository =
        options.repo === undefined
          ? {}
          : { repository: repositoryArgument(options.repo, kit.io.cwd) };
      show(
        options.json,
        (await call(context(), 'integration_list', repository)) as ConnectionView[],
      );
    });
}

function addWriteCommands(kit: Kit): void {
  const { root, examples, context, show, print, io } = kit;
  root
    .command('add')
    .description('Create a connection of a built-in kind; it starts disabled, without secrets')
    .argument('<kind>', 'a kind from `aip integration types`')
    .argument('<name>', 'name, unique per kind in its scope')
    .option('-r, --repo <project>', 'project path or slug (default: the current repository)')
    .option('--global', 'share the connection between projects instead')
    .option(
      '--param <key=value...>',
      'non-secret parameter of the kind',
      (v, all: string[] = []) => [...all, v],
    )
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples(['aip integration add example main --repo shop --param region=eu']),
    )
    .action(
      async (
        kind: string,
        name: string,
        options: { repo?: string; global?: boolean; param?: string[]; json?: boolean },
      ) => {
        if (options.global === true && options.repo !== undefined) {
          throw usage('pass either --repo or --global');
        }
        const scope =
          options.global === true
            ? { global: true }
            : { repository: repositoryArgument(options.repo ?? '.', io.cwd) };
        const view = (await call(context(), 'integration_add', {
          kind,
          name,
          ...scope,
          params: parseParams(options.param ?? []),
        })) as ConnectionView;
        show(options.json, [view]);
      },
    );
  for (const [verb, method, text] of [
    ['enable', 'integration_enable', 'Enable a connection that has every required secret'],
    ['disable', 'integration_disable', 'Disable a connection; its secrets stay'],
  ] as const) {
    root
      .command(verb)
      .description(text)
      .argument('<id>', 'connection id')
      .option('--json', 'print JSON')
      .addHelpText('after', examples([`aip integration ${verb} c1a2b3c4d5e6`]))
      .action(async (id: string, options: { json?: boolean }) => {
        show(options.json, [(await call(context(), method, { id })) as ConnectionView]);
      });
  }
  root
    .command('remove')
    .description('Remove a connection and its secrets; repeat it if the cleanup was cut short')
    .argument('<id>', 'connection id')
    .addHelpText('after', examples(['aip integration remove c1a2b3c4d5e6']))
    .action(async (id: string) => {
      await call(context(), 'integration_remove', { id });
      print(`Removed ${id}`);
    });
}

function addSecretCommands(kit: Kit): void {
  const { root, examples, context, print, io } = kit;
  const secret = root.command('secret').description('Set or remove a secret of a connection');
  secret
    .command('set')
    .description('Store a secret read from stdin (never from an argument)')
    .argument('<id>', 'connection id')
    .argument('<slot>', 'secret slot of the kind')
    .option('--stdin', 'read the value from stdin')
    .addHelpText(
      'after',
      examples(['aip integration secret set c1a2b3c4d5e6 token --stdin < token.txt']),
    )
    .action(async (id: string, slot: string, options: { stdin?: boolean }) => {
      if (options.stdin !== true) throw usage('pass --stdin: a secret is never an argument');
      const value = await secretFromStdin(io);
      await call(context(), 'integration_secret_set', { id, slot, value });
      print(`Secret ${slot} of ${id} is set`);
    });
  secret
    .command('remove')
    .description('Remove a secret; the connection is disabled first')
    .argument('<id>', 'connection id')
    .argument('<slot>', 'secret slot of the kind')
    .addHelpText('after', examples(['aip integration secret remove c1a2b3c4d5e6 token']))
    .action(async (id: string, slot: string) => {
      await call(context(), 'integration_secret_remove', { id, slot });
      print(`Secret ${slot} of ${id} is removed`);
    });
}

export function registerIntegrations(program: Command, io: CliIo, style: Style): void {
  const kit = integrationKit(program, io, style);
  addReadCommands(kit);
  addWriteCommands(kit);
  addSecretCommands(kit);
}
