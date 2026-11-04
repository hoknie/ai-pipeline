import { Command } from 'commander';

import { colorEnabled, createStyle } from '../protocol/index.ts';

import { registerCommands } from './commands.ts';
import { addFooter, bareHelpTarget, configureHelpStyle } from './help.ts';
import { failLine, type CliIo } from './io.ts';
import { VERSION } from './version.ts';

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
  const style = createStyle(colors);

  const program = new Command()
    .name('aip')
    .description('Local orchestrator for a swarm of AI agents (Claude Code, OpenCode)')
    .version(VERSION)
    .option('--no-color', 'turn off colors (NO_COLOR and FORCE_COLOR are honored too)');

  configureHelpStyle(program, style, colors);
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
    failLine(io, 'aip', (error as Error).message);
  }
}
