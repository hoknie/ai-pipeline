import type { Command } from 'commander';

import { formatAudit, type Style } from '../../../format/index.ts';
import { repositoryArgument } from '../../../ipc/client/index.ts';
import type { AuditView } from '../../../ipc/contract/index.ts';
import { bind, call } from '../../context.ts';
import { usage, type CliIo } from '../../io.ts';

/** `aip audit`: the journal of the actions of the server, for administrators. */
export function registerAudit(program: Command, io: CliIo, style: Style): void {
  const { output, examples, context, activeStyle } = bind(io, style);
  program
    .command('audit')
    .description('Show the audit journal of the server: who did what, newest first (admins only)')
    .option('--user <email>', 'only the actions of this user (or `system`)')
    .option('--repo <slug|path>', 'only the actions on this project')
    .option('--action <prefix>', 'only the actions that start with this text, such as `run.`')
    .option('--since <period>', 'how far back: <n>m, <n>h or <n>d (default 7d)')
    .option('--limit <n>', 'at most this many entries (default 200, at most 1000)')
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip audit',
        'aip audit --user bob@corp.com --action run. --since 1d',
        'aip audit --repo app --action config. --json',
      ]),
    )
    .action(
      async (options: {
        user?: string;
        repo?: string;
        action?: string;
        since?: string;
        limit?: string;
        json?: boolean;
      }) => {
        if (options.limit !== undefined && !/^[1-9]\d*$/.test(options.limit)) {
          throw usage('--limit must be a positive integer');
        }
        const view = (await call(context(), 'audit_list', {
          ...(options.user === undefined ? {} : { user: options.user }),
          ...(options.repo === undefined
            ? {}
            : { repository: repositoryArgument(options.repo, io.cwd) }),
          ...(options.action === undefined ? {} : { action: options.action }),
          ...(options.since === undefined ? {} : { since: options.since }),
          ...(options.limit === undefined ? {} : { limit: Number(options.limit) }),
        })) as AuditView;
        output(options.json, formatAudit(view.events, activeStyle), view.events);
      },
    );
}
