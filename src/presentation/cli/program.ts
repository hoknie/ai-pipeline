import { Command, CommanderError } from 'commander';

import { packageVersion } from '../../platform/build/index.ts';
import { errorMessage } from '../../platform/errors/index.ts';
import { colorEnabled, createStyle, plainStyle, type Style } from '../format/index.ts';

import { registerDaemon, registerEvents } from './commands/daemon.ts';
import { registerGroup } from './commands/group.ts';
import { registerMcp } from './commands/mcp.ts';
import { registerOverview } from './commands/overview/index.ts';
import { registerQueue } from './commands/queue.ts';
import { registerRepositories } from './commands/repositories.ts';
import { registerRun } from './commands/run.ts';
import { registerSetup } from './commands/setup.ts';
import { registerStats } from './commands/stats.ts';
import { registerTag } from './commands/tag.ts';
import { registerWeb } from './commands/web.ts';
import { HELP_GROUPS, addFooter, bareHelpTarget, configureHelpStyle } from './help.ts';
import { failLine, type CliIo } from './io.ts';

/**
 * Runs the CLI for `argv` (the whole `process.argv`). The working directory, the environment,
 * the output streams and the exit code are the ones of `io`. Failures set the exit code 1.
 */
export async function runCli(argv: string[], io: CliIo): Promise<void> {
  const args = argv.slice(2);
  const noColorFlag = args.includes('--no-color');
  const colors = colorEnabled({
    noColorFlag,
    env: io.env,
    isTTY: io.isTTY,
  });
  const style = createStyle(colors, io.columns);

  const program = new Command()
    .name('aip')
    .description('Local orchestrator for a swarm of AI agents (Claude Code, OpenCode)')
    .version(packageVersion())
    .option('--no-color', 'turn off colors (NO_COLOR and FORCE_COLOR are honored too)');

  configureHelpStyle(program, style, colors);
  // Help, version and parse errors go to the streams of the call, and commander leaves the
  // process alone; subcommands inherit both, so they are set before the commands are added.
  program
    .configureOutput({ writeOut: (text) => io.stdout(text), writeErr: (text) => io.stderr(text) })
    .exitOverride();
  registerCommands(program, style, io);
  addFooter(program, style);

  try {
    const target = bareHelpTarget(
      program,
      args.filter((arg) => arg !== '--no-color'),
    );
    if (target) target.help();
    await program.parseAsync(argv);
  } catch (error) {
    // commander has already printed its message (help, version or a parse error)
    if (error instanceof CommanderError) io.setExitCode(error.exitCode);
    else failLine(io, 'aip', errorMessage(error));
  }
}

/** Adds every command to `program`, grouped as the help shows them. */
export function registerCommands(program: Command, style: Style = plainStyle, io: CliIo): void {
  const [runs, queueGroup, dashboards, setup, plumbing] = HELP_GROUPS;
  program.commandsGroup(runs!.heading);
  registerRun(program, io, style);
  registerGroup(program, io, style);
  program.commandsGroup(queueGroup!.heading);
  registerQueue(program, io, style);
  registerRepositories(program, io, style);
  registerTag(program, io, style);
  program.commandsGroup(dashboards!.heading);
  registerOverview(program, io, style);
  registerWeb(program, io, style);
  registerEvents(program, io, style);
  registerStats(program, io, style);
  program.commandsGroup(setup!.heading);
  registerSetup(program, io, style);
  program.helpCommand('help [command]', 'Show help for a command');
  program.commandsGroup(plumbing!.heading);
  registerDaemon(program, style, io);
  registerMcp(program, io, style);
}
