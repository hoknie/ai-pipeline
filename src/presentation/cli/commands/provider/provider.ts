import type { Command } from 'commander';

import { formatProvider, formatProviderList } from '../../../format/providers/index.ts';
import { providerText } from '../../../format/providers/index.ts';
import { type Style } from '../../../format/index.ts';
import { repositoryArgument } from '../../../ipc/client/index.ts';
import type { ProvidersView } from '../../../ipc/contract/index.ts';
import { bind, call } from '../../context.ts';
import { usage, type CliIo } from '../../io.ts';

/** The view of the repository; a configuration that does not load fails the command. */
async function providersOf(
  context: ReturnType<ReturnType<typeof bind>['context']>,
  repository: string,
): Promise<ProvidersView> {
  const view = (await call(context, 'config_providers', { repository })) as ProvidersView;
  if (view.errors.length > 0) {
    const lines = view.errors.map((error) => `${error.path}: ${error.message}`);
    throw usage(`configuration not loaded:\n${lines.join('\n')}`);
  }
  return view;
}

export function registerProvider(program: Command, io: CliIo, style: Style): void {
  const { output, examples, context, activeStyle } = bind(io, style);
  const provider = program
    .command('provider')
    .description('Providers of the configuration: status, access routes and models by role');
  provider
    .command('list')
    .description('Show the providers of the repository with their status')
    .option('-r, --repo <path>', 'repository path or project slug', '.')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip provider list', 'aip provider list --json']))
    .action(async (options: { repo: string; json?: boolean }) => {
      const view = await providersOf(context(), repositoryArgument(options.repo, io.cwd));
      output(options.json, formatProviderList(view, activeStyle), view);
    });
  provider
    .command('show')
    .description('Show one provider: access routes with reasons and the models of the roles')
    .argument('<slug>', 'provider slug')
    .option('-r, --repo <path>', 'repository path or project slug', '.')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip provider show zai']))
    .action(async (slug: string, options: { repo: string; json?: boolean }) => {
      const view = await providersOf(context(), repositoryArgument(options.repo, io.cwd));
      const found = view.providers.find((item) => item.slug === slug);
      if (found === undefined) {
        const known = view.providers.map((item) => providerText(item.slug, item.name));
        throw usage(`unknown provider \`${slug}\`; known: ${known.join(', ') || 'none'}`);
      }
      const cells = view.matrix.filter((cell) => cell.provider === slug);
      output(options.json, formatProvider(view, found, activeStyle), { ...found, matrix: cells });
    });
}
