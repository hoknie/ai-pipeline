import { relative, resolve } from 'node:path';

import type { Command } from 'commander';

import { packageVersion } from '../../../platform/build/index.ts';
import type { Style } from '../../format/index.ts';
import { bind, call } from '../context.ts';
import { failLine, type CliIo } from '../io.ts';

function addSetup(program: Command, io: CliIo, style: Style): void {
  const { print, examples, activeStyle } = bind(io, style);
  program
    .command('setup')
    .description('Connect aip to Claude Code and OpenCode on this machine')
    .option('-y, --yes', 'do not ask questions')
    .option('--dry-run', 'print what would be done and change nothing')
    .option('--force', 'replace an existing aip setting that differs')
    .option('--no-claude', 'skip Claude Code')
    .option('--no-opencode', 'skip OpenCode')
    .option('--no-plugin', 'do not install the Claude Code plugin')
    .addHelpText(
      'after',
      examples(['aip setup', 'aip setup --dry-run', 'aip setup --yes --no-opencode']),
    )
    .action(
      async (options: {
        yes?: boolean;
        dryRun?: boolean;
        force?: boolean;
        claude: boolean;
        opencode: boolean;
        plugin: boolean;
      }) => {
        const { setupCommand, systemDeps } = await import('../setup/index.ts');
        io.setExitCode(
          await setupCommand(
            {
              yes: options.yes ?? false,
              dryRun: options.dryRun ?? false,
              force: options.force ?? false,
              claude: options.claude,
              opencode: options.opencode,
              plugin: options.plugin,
            },
            activeStyle,
            systemDeps(io.env),
            print,
            io.ask,
          ),
        );
      },
    );
}

function addInit(program: Command, io: CliIo, style: Style): void {
  const { print, examples, context, activeStyle } = bind(io, style);
  program
    .command('init')
    .description('Create a starter aip/ configuration in the current repository')
    .option('--shared', 'write to the shared configuration (~/.config/aip) instead')
    .addHelpText('after', examples(['aip init', 'aip init --shared']))
    .action(async (options: { shared?: boolean }) => {
      try {
        const { initConfig } = await import('../local/init.ts');
        const result = await initConfig({
          cwd: io.cwd,
          shared: options.shared ?? false,
          env: io.env,
        });
        const show = (file: string): string => relative(io.cwd, file) || file;
        if (result.repository !== null) {
          // The web panel lists the daemon's registry only, so the initialized repository joins it.
          try {
            await call(context(), 'repository_add', { path: result.repository });
          } catch (error) {
            io.stderr(
              `aip: warning: could not add the repository to the list: ${(error as Error).message}\n`,
            );
          }
        }
        for (const file of result.created) print(`${activeStyle.success('created')} ${show(file)}`);
        for (const file of result.kept)
          print(`${activeStyle.muted('kept   ')} ${show(file)} (already exists)`);
        print(
          `\nNext: ${activeStyle.command('aip config check')}, then ${activeStyle.command('aip run start feature --task "Describe the task"')}`,
        );
      } catch (error) {
        failLine(io, 'aip init', (error as Error).message);
      }
    });
}

function addConfig(program: Command, io: CliIo, style: Style): void {
  const { examples } = bind(io, style);
  const config = program.command('config').description('Inspect the aip/ configuration');
  config
    .command('check')
    .description(
      'Validate the aip/ configuration and print the merged configuration and agent CLI versions',
    )
    .option('-r, --repo <path>', 'repository path', '.')
    .addHelpText('after', examples(['aip config check', 'aip config check --repo ~/projects/app']))
    .action(async (options: { repo: string }) => {
      const { checkConfig } = await import('../local/config-check.ts');
      io.setExitCode(await checkConfig(resolve(io.cwd, options.repo), io));
    });
}

function addVersion(program: Command, io: CliIo, style: Style): void {
  const { print, examples } = bind(io, style);
  program
    .command('version')
    .description('Print the aip version (same as --version)')
    .option('--json', 'print JSON on one line')
    .addHelpText('after', examples(['aip version', 'aip version --json']))
    .action((options: { json?: boolean }) => {
      const version = packageVersion();
      print(options.json ? JSON.stringify({ version }) : version);
    });
}

/** `setup`, `init`, `config` and `version`: the commands that need no daemon for their own work. */
export function registerSetup(program: Command, io: CliIo, style: Style): void {
  addSetup(program, io, style);
  addInit(program, io, style);
  addConfig(program, io, style);
  addVersion(program, io, style);
}
