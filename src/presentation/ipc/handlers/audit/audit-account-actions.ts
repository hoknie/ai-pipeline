import type { Method } from '../../contract/index.ts';
import { type AuditRow, account, pick, signIn } from './audit-helpers.ts';

/** The accounts: the catalog of rights names the action; the journal keeps its own event. */
export const accountActions: Partial<Record<Method, AuditRow>> = {
  users_set: {
    action: 'users.manage',
    event: 'user.attributes',
    info: (params) => ({
      ...account(params),
      details: { attributes: Object.keys((params.attributes as object | undefined) ?? {}) },
    }),
  },
  users_disable: { action: 'users.manage', event: 'user.disable', info: account },
  users_enable: { action: 'users.manage', event: 'user.enable', info: account },
  login_link_create: {
    action: 'users.manage',
    event: 'login_link.create',
    info: (params) => ({ ...account(params), details: pick(params, 'admin', 'ttl') }),
  },
  tokens_create: {
    action: 'token.manage',
    event: 'token.create',
    info: (params) => ({ repository: null, details: pick(params, 'name', 'ttl') }),
  },
  tokens_revoke: {
    action: 'token.manage',
    event: 'token.revoke',
    info: () => ({ repository: null }),
  },
  auth_link_login: {
    action: 'auth.login',
    failedEvent: 'auth.login_failed',
    info: signIn('link'),
  },
  auth_oidc_complete: {
    action: 'auth.login',
    failedEvent: 'auth.login_failed',
    info: signIn('oidc'),
  },
  auth_saml_complete: {
    action: 'auth.login',
    failedEvent: 'auth.login_failed',
    info: signIn('saml'),
  },
  cli_login_exchange: {
    action: 'auth.login',
    failedEvent: 'auth.login_failed',
    info: signIn('cli'),
  },
  cli_login_approve: { action: 'auth.cli_approve', info: () => ({ repository: null }) },
  auth_logout: { action: 'auth.logout', info: signIn('session') },
};
