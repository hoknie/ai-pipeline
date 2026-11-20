import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { DELIVERY_MODES, type DeliveryMode } from '../../feature/swarm-config/types/index.ts';
import { proposedGroupSchema } from '../ipc/contract/index.ts';

import type { Command } from 'commander';

import type { UserDirectoryEntry } from '../ipc/contract/index.ts';

import { call, type Context } from './context.ts';
import { usage } from './io.ts';

export function readGroups(file: string) {
  return proposedGroupSchema
    .array()
    .min(1)
    .parse(parseYaml(readFileSync(file, 'utf8')));
}

/** Collects a repeatable option into a list. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** `--attach` paths as the request names them: relative paths are taken from the current directory. */
export function attachmentSources(paths: string[] | undefined): { path: string }[] | undefined {
  return paths === undefined ? undefined : paths.map((path) => ({ path: resolve(path) }));
}

export interface QueueTaskOptions {
  attach?: string[];
  tag?: string[];
  parent?: string | false;
  after?: string[];
  skip?: string[];
  variant?: string;
  /** A provider id; `false` after `--no-provider` of `queue edit`. */
  provider?: string | false;
  task?: string;
  groups?: string;
  title?: string;
  autoDeliver?: boolean;
  deliveryMode?: string;
  postpone?: boolean;
  repo: string;
  json?: boolean;
}

/** `--note <project>=<text>` into the notes of `queue_add_projects`. */
export function parseNotes(values: string[] | undefined): Record<string, string> | undefined {
  if (values === undefined) return undefined;
  const notes: Record<string, string> = {};
  for (const value of values) {
    const split = value.indexOf('=');
    if (split < 1) throw usage(`--note must be <project>=<text>, got \`${value}\``);
    notes[value.slice(0, split)] = value.slice(split + 1);
  }
  return notes;
}

export function parseDeliveryMode(value: string | undefined): DeliveryMode | undefined {
  if (value === undefined) return undefined;
  const mode = DELIVERY_MODES.find((candidate) => candidate === value);
  if (mode === undefined) {
    throw usage(`--delivery-mode must be one of: ${DELIVERY_MODES.join(', ')}`);
  }
  return mode;
}

export function parseSwitch(flag: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'on') return true;
  if (value === 'off') return false;
  throw usage(`${flag} must be on or off`);
}

/** `--mine` and `--author`: the lists of runs and of the queue show only the runs and tasks of one author. */
export function addAuthorOptions(command: Command): Command {
  return command
    .option('--mine', 'only what you created (server mode)')
    .option('--author <email>', 'only what this user created (server mode)');
}

export interface AuthorOptions {
  mine?: boolean;
  author?: string;
}

/**
 * The `author` parameter of a request: `me` for `--mine` (or `--author me` where `allowMe` is set),
 * the id of the user for an email, nothing when no flag is given.
 */
export async function authorParameter(
  ctx: Context,
  options: AuthorOptions,
  allowMe = false,
): Promise<{ author?: string }> {
  if (options.mine === true && options.author !== undefined) {
    throw usage('--mine and --author cannot be combined');
  }
  if (options.mine === true) return { author: 'me' };
  if (options.author === undefined) return {};
  if (allowMe && options.author === 'me') return { author: 'me' };
  const { users } = (await call(ctx, 'users_directory', {})) as { users: UserDirectoryEntry[] };
  const email = options.author.trim().toLowerCase();
  const found = users.find((user) => user.email.toLowerCase() === email);
  if (found === undefined) throw usage(`unknown user "${options.author}"`);
  return { author: found.id };
}
