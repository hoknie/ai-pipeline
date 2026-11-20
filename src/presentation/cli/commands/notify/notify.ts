import type { Command } from 'commander';

import { formatDeliveries, formatSubscriptions, type Style } from '../../../format/index.ts';
import { repositoryArgument } from '../../../ipc/client/index.ts';
import type { DeliveryView, SubscriptionView } from '../../../ipc/contract/index.ts';
import { bind, call, type Context } from '../../context.ts';
import { usage, type CliIo } from '../../io.ts';

const DEFAULT_LOG_LIMIT = 20;

function parseEvents(text: string): string[] {
  const events = text
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '');
  if (events.length === 0)
    throw usage('pass --events as <kind>,<kind>: question, failed, conflict, delivery, finished');
  return events;
}

function parseLimit(text: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    throw usage('--limit is a whole number from 1 to 200');
  }
  return value;
}

/** What the commands of the group share: the group itself, the output and the helpers. */
interface Kit {
  root: Command;
  print: (text: string) => void;
  output: (json: boolean | undefined, text: string, data: unknown) => void;
  examples: (lines: string[]) => string;
  context: () => Context;
  activeStyle: Style;
  io: CliIo;
  show: (json: boolean | undefined, views: SubscriptionView[]) => void;
}

function addList(kit: Kit): void {
  const { root, print, output, examples, context, activeStyle, io, show } = kit;
  root
    .command('list')
    .description('Show subscriptions (of one project and of all projects with --repo)')
    .option('-r, --repo <project>', 'project path or slug')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip notify list', 'aip notify list --repo shop']))
    .action(async (options: { repo?: string; json?: boolean }) => {
      const repository =
        options.repo === undefined ? {} : { repository: repositoryArgument(options.repo, io.cwd) };
      show(options.json, (await call(context(), 'notify_list', repository)) as SubscriptionView[]);
    });
}

function addSubscribe(kit: Kit): void {
  const { root, print, output, examples, context, activeStyle, io, show } = kit;
  root
    .command('add')
    .description('Subscribe a project, or all projects, to events through a chat connection')
    .argument('<connection>', 'id of a chat connection, see `aip integration list`')
    .option('-r, --repo <project>', 'project path or slug; `.` is the current repository')
    .option('--all-projects', 'every project of a shared connection')
    .option(
      '--events <kinds>',
      'question, failed, conflict, delivery, finished (default: question)',
    )
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip notify add c1a2b3c4d5e6 --repo . --events question,failed',
        'aip notify add c1a2b3c4d5e6 --all-projects',
      ]),
    )
    .action(
      async (
        connection: string,
        options: { repo?: string; allProjects?: boolean; events?: string; json?: boolean },
      ) => {
        if ((options.repo === undefined) === (options.allProjects !== true)) {
          throw usage('pass either --repo <project> or --all-projects');
        }
        const scope =
          options.allProjects === true
            ? { allProjects: true }
            : { repository: repositoryArgument(options.repo ?? '.', io.cwd) };
        const view = (await call(context(), 'notify_add', {
          connection,
          ...scope,
          ...(options.events === undefined ? {} : { events: parseEvents(options.events) }),
        })) as SubscriptionView;
        show(options.json, [view]);
      },
    );
}

function addChange(kit: Kit): void {
  const { root, print, output, examples, context, activeStyle, io, show } = kit;
  root
    .command('edit')
    .description('Change the events of a subscription')
    .argument('<id>', 'subscription id')
    .requiredOption('--events <kinds>', 'question, failed, conflict, delivery, finished')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip notify edit n1a2b3c4d5e6 --events question,finished']))
    .action(async (id: string, options: { events: string; json?: boolean }) => {
      const view = (await call(context(), 'notify_edit', {
        id,
        events: parseEvents(options.events),
      })) as SubscriptionView;
      show(options.json, [view]);
    });
}

function addSwitches(kit: Kit): void {
  const { root, print, output, examples, context, activeStyle, io, show } = kit;
  for (const [verb, method, text] of [
    ['enable', 'notify_enable', 'Turn a subscription on'],
    ['disable', 'notify_disable', 'Turn a subscription off; its journal stays'],
  ] as const) {
    root
      .command(verb)
      .description(text)
      .argument('<id>', 'subscription id')
      .option('--json', 'print JSON')
      .addHelpText('after', examples([`aip notify ${verb} n1a2b3c4d5e6`]))
      .action(async (id: string, options: { json?: boolean }) => {
        show(options.json, [(await call(context(), method, { id })) as SubscriptionView]);
      });
  }

  root
    .command('remove')
    .description('Remove a subscription with its journal')
    .argument('<id>', 'subscription id')
    .addHelpText('after', examples(['aip notify remove n1a2b3c4d5e6']))
    .action(async (id: string) => {
      await call(context(), 'notify_remove', { id });
      print(`Removed ${id}`);
    });
}

function addDelivery(kit: Kit): void {
  const { root, print, output, examples, context, activeStyle, io, show } = kit;
  root
    .command('test')
    .description(
      'Send a test message through a subscription; exits with 1 if the channel refuses it',
    )
    .argument('<id>', 'subscription id')
    .addHelpText('after', examples(['aip notify test n1a2b3c4d5e6']))
    .action(async (id: string) => {
      await call(context(), 'notify_test', { id });
      print(`Test message sent through ${id}`);
    });

  root
    .command('log')
    .description('Show the journal of sending, the newest first')
    .option('--subscription <id>', 'only this subscription')
    .option('--state <state>', 'pending, sent, failed or closed')
    .option('--limit <n>', 'how many lines', String(DEFAULT_LOG_LIMIT))
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip notify log', 'aip notify log --state failed --limit 5']))
    .action(
      async (options: { subscription?: string; state?: string; limit: string; json?: boolean }) => {
        const views = (await call(context(), 'notify_log', {
          ...(options.subscription === undefined ? {} : { subscription: options.subscription }),
          ...(options.state === undefined ? {} : { state: options.state }),
          limit: parseLimit(options.limit),
        })) as DeliveryView[];
        output(options.json, formatDeliveries(views, activeStyle), views);
      },
    );
}

export function registerNotify(program: Command, io: CliIo, style: Style): void {
  const { print, output, examples, context, activeStyle } = bind(io, style);
  const root = program
    .command('notify')
    .description('Notifications to a chat: subscriptions of projects to events, test, journal');
  const show = (json: boolean | undefined, views: SubscriptionView[]): void =>
    output(json, formatSubscriptions(views, activeStyle), views);
  const kit: Kit = { root, print, output, examples, context, activeStyle, io, show };
  for (const add of [addList, addSubscribe, addChange, addSwitches, addDelivery]) add(kit);
}
