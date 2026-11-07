import type { Command } from 'commander';

import type { Style } from '../format/index.ts';

export interface HelpGroup {
  heading: string;
  commands: string[];
}

/** Groups of `aip --help`, in the order they are printed. */
export const HELP_GROUPS: HelpGroup[] = [
  { heading: 'Runs:', commands: ['run', 'group'] },
  { heading: 'Queue & repositories:', commands: ['queue', 'repo', 'tag'] },
  { heading: 'Dashboards & streams:', commands: ['web', 'events'] },
  { heading: 'Setup & maintenance:', commands: ['setup', 'init', 'config', 'version', 'help'] },
  { heading: 'Plumbing (started by hosts and aip itself):', commands: ['daemon', 'mcp'] },
];

export const HELP_FOOTER = [
  "Run 'aip <command> --help' for details.",
  'Docs: README.md and docs/README.md',
].join('\n');

/** The `Examples:` block of a command; every line is a full command starting with `aip`. */
export function examples(lines: string[], style: Style): string {
  return `\n${style.title('Examples:')}\n${lines.map((line) => `  ${style.muted('$')} ${line}`).join('\n')}\n`;
}

/** Applies the colors to the help of every command; the output decides by itself whether to strip them. */
export function configureHelpStyle(program: Command, style: Style, colors: boolean): void {
  program.configureHelp({
    styleTitle: (text) => style.title(text),
    styleCommandText: (text) => style.command(text),
    styleSubcommandText: (text) => style.command(text),
    styleOptionText: (text) => style.option(text),
    styleArgumentText: (text) => style.argument(text),
    styleDescriptionText: (text) => text,
  });
  program.configureOutput({
    getOutHasColors: () => colors,
    getErrHasColors: () => colors,
  });
}

export function addFooter(program: Command, style: Style): void {
  program.addHelpText('after', `\n${style.muted(HELP_FOOTER)}\n`);
}

/** Commands with subcommands that also do something on their own: bare `aip daemon` runs it. */
const RUNNABLE = new Set(['daemon', 'web']);

/**
 * The command whose help to print for `aip` or `aip <noun>` without a verb, or null.
 * `args` are the arguments after the script name, without `--no-color`.
 */
export function bareHelpTarget(program: Command, args: string[]): Command | null {
  if (args.length === 0) return program;
  if (args.length !== 1) return null;
  const sub = program.commands.find((command) => command.name() === args[0]);
  return sub !== undefined && sub.commands.length > 0 && !RUNNABLE.has(sub.name()) ? sub : null;
}
