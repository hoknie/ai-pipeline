import type { Command } from 'commander';

import {
  formatWebhookDeliveries,
  formatWebhooks,
  formatWebhookTest,
  webhookNextSteps,
  type Style,
} from '../../../format/index.ts';
import { repositoryArgument } from '../../../ipc/client/index.ts';
import type {
  WebhookDeliveryView,
  WebhookTestView,
  WebhookView,
} from '../../../ipc/contract/index.ts';
import { bind, call, type Context } from '../../context.ts';
import { usage, type CliIo } from '../../io.ts';

const DEFAULT_LOG_LIMIT = 20;
const EVENT_NAMES = 'question, failed, conflict, delivery, finished';

function parseEvents(text: string): string[] {
  const events = text
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '');
  if (events.length === 0) throw usage(`pass --events as <kind>,<kind>: ${EVENT_NAMES}`);
  return events;
}

function parseLimit(text: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    throw usage('--limit is a whole number from 1 to 200');
  }
  return value;
}

interface Kit {
  root: Command;
  print: (text: string) => void;
  output: (json: boolean | undefined, text: string, data: unknown) => void;
  examples: (lines: string[]) => string;
  context: () => Context;
  activeStyle: Style;
  io: CliIo;
  show: (json: boolean | undefined, views: WebhookView[]) => void;
}

function addList(kit: Kit): void {
  const { root, examples, context, io, show } = kit;
  root
    .command('list')
    .description('Show webhooks (of one project and of all projects with --repo)')
    .option('-r, --repo <project>', 'project path or slug')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip webhook list', 'aip webhook list --repo shop']))
    .action(async (options: { repo?: string; json?: boolean }) => {
      const repository =
        options.repo === undefined ? {} : { repository: repositoryArgument(options.repo, io.cwd) };
      show(options.json, (await call(context(), 'webhook_list', repository)) as WebhookView[]);
    });
}

function addCreate(kit: Kit): void {
  const { root, print, examples, context, io, show } = kit;
  root
    .command('add')
    .description('Make a webhook; it starts disabled, without a signing secret')
    .argument('<name>', 'name, unique among webhooks in its scope')
    .requiredOption('--url <url>', 'http(s) address the events are sent to')
    .option('-r, --repo <project>', 'project path or slug; `.` is the current repository')
    .option('--all-projects', 'events of every project')
    .option('--events <kinds>', `${EVENT_NAMES} (default: question)`)
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip webhook add ci --url https://ci.example.com/aip --repo .',
        'aip webhook add audit --url https://hooks.example.com/aip --all-projects --events question,finished',
      ]),
    )
    .action(
      async (
        name: string,
        options: {
          url: string;
          repo?: string;
          allProjects?: boolean;
          events?: string;
          json?: boolean;
        },
      ) => {
        if ((options.repo === undefined) === (options.allProjects !== true)) {
          throw usage('pass either --repo <project> or --all-projects');
        }
        const scope =
          options.allProjects === true
            ? { allProjects: true }
            : { repository: repositoryArgument(options.repo ?? '.', io.cwd) };
        const view = (await call(context(), 'webhook_add', {
          name,
          url: options.url,
          ...scope,
          ...(options.events === undefined ? {} : { events: parseEvents(options.events) }),
        })) as WebhookView;
        show(options.json, [view]);
        if (options.json !== true) print(`\n${webhookNextSteps(view)}`);
      },
    );
}

function addChange(kit: Kit): void {
  const { root, examples, context, show } = kit;
  root
    .command('edit')
    .description('Change the address or the events of a webhook; the secret and the state stay')
    .argument('<id>', 'id of the webhook (of its connection), from `aip webhook list`')
    .option('--url <url>', 'new address')
    .option('--events <kinds>', EVENT_NAMES)
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip webhook edit c1a2b3c4d5e6 --url https://ci.example.com/v2/aip',
        'aip webhook edit c1a2b3c4d5e6 --events question,failed',
      ]),
    )
    .action(async (id: string, options: { url?: string; events?: string; json?: boolean }) => {
      if (options.url === undefined && options.events === undefined) {
        throw usage('pass --url or --events');
      }
      const view = (await call(context(), 'webhook_edit', {
        id,
        ...(options.url === undefined ? {} : { url: options.url }),
        ...(options.events === undefined ? {} : { events: parseEvents(options.events) }),
      })) as WebhookView;
      show(options.json, [view]);
    });
}

function addSwitches(kit: Kit): void {
  const { root, print, examples, context, show } = kit;
  for (const [verb, method, text] of [
    ['enable', 'webhook_enable', 'Turn a webhook on; it needs its signing secret'],
    ['disable', 'webhook_disable', 'Turn a webhook off; its journal stays'],
  ] as const) {
    root
      .command(verb)
      .description(text)
      .argument('<id>', 'id of the webhook')
      .option('--json', 'print JSON')
      .addHelpText('after', examples([`aip webhook ${verb} c1a2b3c4d5e6`]))
      .action(async (id: string, options: { json?: boolean }) => {
        show(options.json, [(await call(context(), method, { id })) as WebhookView]);
      });
  }
  root
    .command('remove')
    .description('Remove a webhook with its secret and its journal')
    .argument('<id>', 'id of the webhook')
    .addHelpText('after', examples(['aip webhook remove c1a2b3c4d5e6']))
    .action(async (id: string) => {
      await call(context(), 'webhook_remove', { id });
      print(`Removed ${id}`);
    });
}

function addDelivery(kit: Kit): void {
  const { root, print, output, examples, context, activeStyle, io } = kit;
  root
    .command('test')
    .description('Call the address once with a test event; exits with 1 if it is not accepted')
    .argument('<id>', 'id of the webhook')
    .addHelpText('after', examples(['aip webhook test c1a2b3c4d5e6']))
    .action(async (id: string) => {
      const result = (await call(context(), 'webhook_test', { id })) as WebhookTestView;
      print(formatWebhookTest(result));
      if (!result.ok) io.setExitCode(1);
    });

  root
    .command('log')
    .description('Show the deliveries of a webhook with their attempts, the newest first')
    .argument('<id>', 'id of the webhook')
    .option('--state <state>', 'pending, sent, failed or closed')
    .option('--limit <n>', 'how many deliveries', String(DEFAULT_LOG_LIMIT))
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples(['aip webhook log c1a2b3c4d5e6', 'aip webhook log c1a2b3c4d5e6 --state failed']),
    )
    .action(async (id: string, options: { state?: string; limit: string; json?: boolean }) => {
      const views = (await call(context(), 'webhook_log', {
        id,
        ...(options.state === undefined ? {} : { state: options.state }),
        limit: parseLimit(options.limit),
      })) as WebhookDeliveryView[];
      output(options.json, formatWebhookDeliveries(views, activeStyle), views);
    });

  root
    .command('redeliver')
    .description('Send a delivery again, with the same webhook-id, as a new series of attempts')
    .argument('<delivery>', 'id of the delivery, from `aip webhook log`')
    .addHelpText('after', examples(['aip webhook redeliver 42']))
    .action(async (delivery: string) => {
      const id = Number(delivery);
      if (!Number.isInteger(id) || id < 1) throw usage('<delivery> is the number from the log');
      await call(context(), 'webhook_redeliver', { id });
      print(`Delivery ${id} is queued again`);
    });
}

export function registerWebhook(program: Command, io: CliIo, style: Style): void {
  const { print, output, examples, context, activeStyle } = bind(io, style);
  const root = program
    .command('webhook')
    .description('Outgoing webhooks: signed calls to an address on events, journal, test');
  const show = (json: boolean | undefined, views: WebhookView[]): void =>
    output(json, formatWebhooks(views, activeStyle), views);
  const kit: Kit = { root, print, output, examples, context, activeStyle, io, show };
  for (const add of [addList, addCreate, addChange, addSwitches, addDelivery]) add(kit);
}
