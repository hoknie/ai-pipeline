import { rejected } from '../../../../platform/errors/index.ts';
import type { AccessToken, Actor, User } from '../../../../feature/identity/types/index.ts';
import { hasAdminRole, parseAttributeArgument } from '../../../../feature/identity/types/index.ts';
import { appError } from '../../../../platform/errors/index.ts';
import { defaultServer } from '../../../../feature/swarm-config/types/index.ts';
import type { TokenView, UserView } from '../../contract/index.ts';
import type { HandlerTable, IpcContext } from '../types.ts';

export function userView(user: User): UserView {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    attributes: user.attributes,
    source: user.source,
    disabled: user.disabled,
    admin: hasAdminRole(user.attributes),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export function tokenView(token: AccessToken): TokenView {
  return {
    id: token.id,
    name: token.name,
    start: token.start,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    expiresAt: token.expiresAt,
  };
}

const OFF = 'server mode is off: set server.enabled in the shared settings.yaml';

/** The server settings; a broken section counts as the defaults (server mode off). */
export function serverSettings({ services }: IpcContext) {
  const settings = services.config.serverSettings();
  return typeof settings === 'string' ? defaultServer() : settings;
}

function serverOnly(context: IpcContext): void {
  if (!serverSettings(context).enabled) throw rejected(OFF);
}

function userOf(actor: Actor): string {
  if (actor.kind !== 'user')
    throw rejected('this needs a signed in user, not the local or system actor');
  return actor.user.id;
}

export function attributesFrom(items: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const item of items) {
    const parsed = parseAttributeArgument(item);
    if (parsed) result[parsed[0]] = parsed[1];
  }
  return result;
}

/** Accounts of the server mode: users, sessions, links, personal tokens, the login of the CLI. */
export const identityHandlers = {
  auth_resolve: async (params, context) => {
    serverOnly(context);
    const { sessions, tokens } = context.services.identity;
    const user =
      (params.session ? sessions.resolve(params.session) : null) ??
      (params.token ? tokens.resolve(params.token) : null);
    return { user: user ? userView(user) : null };
  },
  auth_link_login: async (params, context) => {
    serverOnly(context);
    const result = context.services.identity.sessions.loginByLink(params.code);
    return { session: result.session, expiresAt: result.expiresAt, user: userView(result.user) };
  },
  auth_logout: async (params, context) => {
    serverOnly(context);
    const { sessions } = context.services.identity;
    const user = sessions.resolve(params.session);
    sessions.logout(params.session);
    return { ok: true, user: user ? userView(user) : null };
  },
  auth_oidc_info: async (_params, context) => {
    serverOnly(context);
    const { sso, saml } = context.services.identity;
    return { sso: sso.info(), saml: saml.info() };
  },
  auth_oidc_begin: async (params, context) => {
    serverOnly(context);
    return context.services.identity.sso.begin({ returnTo: params.returnTo });
  },
  auth_oidc_complete: async (params, context) => {
    serverOnly(context);
    const result = await context.services.identity.sso.complete({ query: params.query });
    return {
      session: result.session,
      expiresAt: result.expiresAt,
      returnTo: result.returnTo,
      user: userView(result.user),
    };
  },
  auth_saml_begin: async (params, context) => {
    serverOnly(context);
    return context.services.identity.saml.begin({ returnTo: params.returnTo });
  },
  auth_saml_complete: async (params, context) => {
    serverOnly(context);
    const result = await context.services.identity.saml.complete(params);
    return {
      session: result.session,
      expiresAt: result.expiresAt,
      returnTo: result.returnTo,
      user: userView(result.user),
    };
  },
  auth_saml_metadata: async (_params, context) => {
    serverOnly(context);
    return context.services.identity.saml.metadata();
  },
  whoami: async (_params, context) => {
    const { actor } = context;
    if (actor.kind !== 'user') return { actor: actor.kind, user: null };
    const user = context.services.identity.users.byId(actor.user.id);
    return { actor: 'user', user: user ? userView(user) : null };
  },
  login_link_create: async (params, context) => {
    serverOnly(context);
    const settings = serverSettings(context);
    const { code, expiresAt } = context.services.identity.sessions.createLink(params);
    return { url: `${settings.publicUrl ?? ''}/auth/link/${code}`, expiresAt };
  },
  users_list: async (_params, context) => {
    serverOnly(context);
    return { users: context.services.identity.users.list().map(userView) };
  },
  users_directory: async (_params, context) => {
    serverOnly(context);
    return {
      users: context.services.identity.users
        .list()
        .map((user) => ({ id: user.id, email: user.email, name: user.name })),
    };
  },
  users_set: async (params, context) => {
    serverOnly(context);
    return userView(context.services.identity.users.setAttributes(params.email, params.attributes));
  },
  users_disable: async (params, context) => {
    serverOnly(context);
    return userView(context.services.identity.users.disable(params.email));
  },
  users_enable: async (params, context) => {
    serverOnly(context);
    return userView(context.services.identity.users.enable(params.email));
  },
  tokens_list: async (_params, context) => {
    serverOnly(context);
    const { tokens } = context.services.identity;
    return { tokens: tokens.list(userOf(context.actor)).map(tokenView) };
  },
  tokens_create: async (params, context) => {
    serverOnly(context);
    const { tokens } = context.services.identity;
    const created = tokens.create(userOf(context.actor), params.name, params.ttl ?? null);
    return { value: created.value, token: tokenView(created.token) };
  },
  tokens_revoke: async (params, context) => {
    serverOnly(context);
    const admin = context.actor.kind === 'user' && hasAdminRole(context.actor.attributes);
    const token = context.services.identity.tokens.revoke(
      userOf(context.actor),
      params.token,
      admin,
    );
    return tokenView(token);
  },
  cli_login_begin: async (params, context) => {
    serverOnly(context);
    context.services.identity.cliLogin.begin(params.challenge, params.machine);
    return { ok: true };
  },
  cli_login_approve: async (params, context) => {
    serverOnly(context);
    const user = context.services.identity.users.byId(userOf(context.actor));
    if (!user) throw appError('unauthorized', 'auth.unauthorized', 'unknown user');
    return context.services.identity.cliLogin.approve(user, params.challenge, params.machine);
  },
  cli_login_exchange: async (params, context) => {
    serverOnly(context);
    const result = context.services.identity.cliLogin.exchange(params.code, params.verifier);
    return { token: result.value, user: userView(result.user) };
  },
} satisfies Partial<HandlerTable>;
