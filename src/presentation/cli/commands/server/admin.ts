import type { Command } from 'commander';

import type { Style } from '../../../format/index.ts';
import type { TokenView, UserView } from '../../../ipc/contract/index.ts';
import { bind, call } from '../../context.ts';
import { parseAttributeArgument } from '../../../../feature/identity/types/index.ts';
import { usage, writeLine, type CliIo } from '../../io.ts';

const stamp = (at: number | null): string => (at === null ? 'never' : new Date(at).toISOString());

function userLine(user: UserView): string {
  const attributes = Object.entries(user.attributes)
    .map(([name, values]) => `${name}=${values.join(',')}`)
    .join(' ');
  return [
    user.email,
    user.name,
    user.source,
    attributes === '' ? '-' : attributes,
    `last login ${stamp(user.lastLoginAt)}`,
    user.disabled ? 'disabled' : 'active',
  ].join('  ');
}

function tokenLine(token: TokenView): string {
  return `${token.name}  ${token.start}…  issued ${stamp(token.createdAt)}  used ${stamp(token.lastUsedAt)}  expires ${stamp(token.expiresAt)}`;
}

function addServer(program: Command, io: CliIo, style: Style): void {
  const { examples, context } = bind(io, style);
  const server = program
    .command('server')
    .description('Administer the aip server: users and login links');
  server
    .command('login-link')
    .description('Print a one-time login link (15 minutes by default, 7 days at most)')
    .requiredOption('--email <email>', 'email of the user; the user is created at the first login')
    .option('--name <name>', 'name of a new user')
    .option('--admin', 'give the user the role admin')
    .option('--ttl <duration>', 'lifetime such as 15m, 12h or 2d')
    .addHelpText('after', examples(['aip server login-link --email admin@example.com --admin']))
    .action(async (options: { email: string; name?: string; admin?: boolean; ttl?: string }) => {
      const made = (await call(context(), 'login_link_create', {
        email: options.email,
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.admin ? { admin: true } : {}),
        ...(options.ttl === undefined ? {} : { ttl: options.ttl }),
      })) as { url: string };
      writeLine(io, made.url);
    });
  const users = server
    .command('users')
    .description('List the users of the server')
    .addHelpText('after', examples(['aip server users']))
    .option('--json', 'print JSON')
    .action(async (options: { json?: boolean }) => {
      const list = (await call(context(), 'users_list', {})) as { users: UserView[] };
      writeLine(
        io,
        options.json ? JSON.stringify(list.users, null, 2) : list.users.map(userLine).join('\n'),
      );
    });
  for (const [name, method] of [
    ['disable', 'users_disable'],
    ['enable', 'users_enable'],
  ] as const) {
    users
      .command(`${name} <email>`)
      .description(`${name === 'disable' ? 'Disable' : 'Enable'} a user`)
      .addHelpText('after', examples([`aip server users ${name} bob@example.com`]))
      .action(async (email: string) => {
        const user = (await call(context(), method, { email })) as UserView;
        writeLine(io, userLine(user));
      });
  }
  users
    .command('set <email> <attributes...>')
    .description('Set attributes of a local user: name=value[,value]; an empty value removes it')
    .addHelpText('after', examples(['aip server users set bob@example.com role=admin team=core']))
    .action(async (email: string, items: string[]) => {
      const attributes: Record<string, string[]> = {};
      for (const item of items) {
        const parsed = parseAttributeArgument(item);
        if (parsed === null) throw usage(`\`${item}\` is not name=value[,value]`);
        attributes[parsed[0]] = parsed[1];
      }
      writeLine(
        io,
        userLine((await call(context(), 'users_set', { email, attributes })) as UserView),
      );
    });
}

function addTokens(program: Command, io: CliIo, style: Style): void {
  const { examples, context } = bind(io, style);
  const token = program
    .command('token')
    .description('Personal access tokens of the signed in user');
  token
    .command('list')
    .description('List your tokens')
    .addHelpText('after', examples(['aip token list']))
    .action(async () => {
      const list = (await call(context(), 'tokens_list', {})) as { tokens: TokenView[] };
      writeLine(io, list.tokens.length === 0 ? 'no tokens' : list.tokens.map(tokenLine).join('\n'));
    });
  token
    .command('create <name>')
    .description('Issue a token; its value is shown once')
    .option('--ttl <duration>', 'lifetime such as 30d (at most server.token_max_ttl)')
    .addHelpText('after', examples(['aip token create ci --ttl 30d']))
    .action(async (name: string, options: { ttl?: string }) => {
      const made = (await call(context(), 'tokens_create', {
        name,
        ...(options.ttl === undefined ? {} : { ttl: options.ttl }),
      })) as { value: string };
      writeLine(io, made.value);
    });
  token
    .command('revoke <token>')
    .description('Revoke a token by its name or the start of its value')
    .addHelpText('after', examples(['aip token revoke ci']))
    .action(async (selector: string) => {
      const revoked = (await call(context(), 'tokens_revoke', { token: selector })) as TokenView;
      writeLine(io, `revoked ${revoked.name}`);
    });
}

export function registerAdmin(program: Command, io: CliIo, style: Style): void {
  addServer(program, io, style);
  addTokens(program, io, style);
}
