import { Command } from 'commander';

import { colorEnabled, createStyle } from '../protocol/index.ts';

import { registerCommands } from './commands.ts';
import { addFooter, bareHelpTarget, configureHelpStyle } from './help.ts';
import { VERSION } from './version.ts';

/**
 * Runs the CLI for `argv` (the whole `process.argv`). Reads the environment, the working
 * directory and the standard streams when it is called, so a caller may point them elsewhere
 * for the duration of the call. Failures set `process.exitCode`.
 */
export async function runCli(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const noColorFlag = args.includes('--no-color');
  const colors = colorEnabled({
    noColorFlag,
    env: process.env,
    isTTY: process.stdout.isTTY === true,
  });
  const style = createStyle(colors);

  const program = new Command()
    .name('aip')
    .description('Local orchestrator for a swarm of AI agents (Claude Code, OpenCode)')
    .version(VERSION)
    .option('--no-color', 'turn off colors (NO_COLOR and FORCE_COLOR are honored too)');

  configureHelpStyle(program, style, colors);
  registerCommands(program, style);
  addFooter(program, style);

  try {
    const target = bareHelpTarget(
      program,
      args.filter((arg) => arg !== '--no-color'),
    );
    if (target) target.help();
    await program.parseAsync(argv);
  } catch (error) {
    process.stderr.write(`aip: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
