import type { Command } from 'commander';

import { formatAccessActions, formatAccessCheck, type Style } from '../../../format/index.ts';
import { repositoryArgument } from '../../../ipc/client/index.ts';
import type { AccessActionsView, AccessCheckView } from '../../../ipc/contract/index.ts';
import { bind, call } from '../../context.ts';
import type { CliIo } from '../../io.ts';

/** `aip access`: what the access policies of the server allow, and why. */
export function registerAccess(program: Command, io: CliIo, style: Style): void {
  const { output, examples, context, activeStyle } = bind(io, style);
  const access = program
    .command('access')
    .description('Explain the access policies of the server (admins only for `check`)');
  access
    .command('check')
    .description('Explain whether a user may do an action: the decision and the rules behind it')
    .requiredOption('--user <email>', 'the user to check')
    .requiredOption('--action <action>', 'an action of `aip access actions`, such as run.apply')
    .option('--repo <slug|path>', 'the project the action is done in')
    .option('--run <id>', 'a run: its project, author, pipeline and tags are the resource')
    .option('--json', 'print JSON')
    .addHelpText(
      'after',
      examples([
        'aip access check --user bob@corp.com --action run.apply --repo billing',
        'aip access check --user bob@corp.com --action run.cancel --run r1 --json',
      ]),
    )
    .action(
      async (options: {
        user: string;
        action: string;
        repo?: string;
        run?: string;
        json?: boolean;
      }) => {
        const view = (await call(context(), 'access_check', {
          user: options.user,
          action: options.action,
          ...(options.repo === undefined
            ? {}
            : { repository: repositoryArgument(options.repo, io.cwd) }),
          ...(options.run === undefined ? {} : { run: options.run }),
        })) as AccessCheckView;
        output(options.json, formatAccessCheck(view, activeStyle), view);
      },
    );
  access
    .command('actions')
    .description('List the actions the policies can allow or deny, with what they are done to')
    .option('--json', 'print JSON')
    .addHelpText('after', examples(['aip access actions', 'aip access actions --json']))
    .action(async (options: { json?: boolean }) => {
      const view = (await call(context(), 'access_actions', {})) as AccessActionsView;
      output(options.json, formatAccessActions(view), view);
    });
}
