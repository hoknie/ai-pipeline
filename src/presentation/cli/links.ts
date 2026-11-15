import type { Command } from 'commander';

import type { LinkInput } from '../../feature/queue/types/index.ts';
import { repositoryArgument } from '../ipc/client/index.ts';
import { call } from './context.ts';
import { usage } from './io.ts';
import { collect } from './options.ts';
import type { QueueKit } from './commands/queue.ts';

/** `--link <kind>:<task>` into the links of a request; a task number becomes a number. */
export function parseLinkFlags(values: string[] | undefined): LinkInput[] | undefined {
  if (values === undefined) return undefined;
  return values.map((value) => {
    const split = value.indexOf(':');
    if (split < 1) throw usage('--link expects <kind>:<task>');
    const kind = value.slice(0, split);
    const target = value.slice(split + 1);
    return { kind, target: /^\d+$/.test(target) ? Number(target) : target };
  });
}

/** The flags the task commands set around `--link`. */
export interface LinkFlagOptions {
  link?: string[];
  /** commander sets this to `false` when `--no-links` is passed. */
  links?: boolean;
}

/** Which of the short flags (`--after`, `--parent` and their `--no-` forms) were passed. */
export interface ShortFlags {
  after?: boolean;
  parent?: boolean;
  noAfter?: boolean;
  noParent?: boolean;
}

/**
 * The links of the request from `--link`; refuses the wrong flag combinations before the daemon
 * is called. `--no-links` (an edit that removes every link) gives an empty list.
 */
export function linkInputsOf(
  options: LinkFlagOptions,
  shorts: ShortFlags = {},
): LinkInput[] | undefined {
  const links = parseLinkFlags(options.link);
  const noLinks = options.links === false;
  if (links !== undefined && noLinks) throw usage('--no-links cannot be combined with --link');
  const shorthand =
    shorts.after === true ||
    shorts.parent === true ||
    shorts.noAfter === true ||
    shorts.noParent === true;
  if (links !== undefined && shorthand) {
    throw usage('--link cannot be combined with --after or --parent');
  }
  return links;
}

/** Adds `--link` to a command of a task; `--no-links` only makes sense for an edit. */
export function linkOptions(command: Command, noLinks = false): Command {
  const withLinks = command.option(
    '--link <kind>:<task>',
    'link of the task, e.g. related:#12; repeat for several',
    collect,
  );
  return noLinks ? withLinks.option('--no-links', 'remove every link of the task') : withLinks;
}

/** `aip queue link` and `aip queue unlink`: connect any two tasks, waiting or started. */
export function addTaskLinks(kit: QueueKit): void {
  const { output, examples, context, queue, common } = kit;
  const command = (
    method: 'task_link' | 'task_unlink',
    name: string,
    description: string,
    done: string,
  ) =>
    common(
      queue
        .command(name)
        .description(description)
        .argument('<source>', 'task the link starts at: an item or run id, or a task number')
        .argument('<kind>', 'one of: blocked_by, parent, related, duplicates')
        .argument('<target>', 'task the link points at'),
    )
      .addHelpText('after', examples([`aip queue ${name} r2 duplicates r1`]))
      .action(
        async (
          source: string,
          kind: string,
          target: string,
          options: { repo: string; json?: boolean },
        ) => {
          const view = await call(context(), method, {
            source,
            kind,
            target,
            repository: repositoryArgument(options.repo),
          });
          output(options.json, `${done} ${source} —${kind}→ ${target}.`, view);
        },
      );
  command(
    'task_link',
    'link',
    'Connect two tasks: the source gets the link of the kind to the target',
    'Linked',
  );
  command(
    'task_unlink',
    'unlink',
    'Remove the link of the kind between two tasks; a link that is not there changes nothing',
    'Unlinked',
  );
}
