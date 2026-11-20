import { z } from 'zod';

/** The address of the client of the panel; the journal of the audit keeps it with a sign-in. */
const address = z.string().trim().min(1).max(64).optional();

const email = z.string().trim().min(3).max(320);

const attributes = z.record(z.string().min(1).max(64), z.array(z.string().min(1).max(256)).max(64));

export const identityRequests = [
  z.object({
    method: z.literal('auth_resolve'),
    params: z.object({
      session: z.string().min(1).max(512).optional(),
      token: z.string().min(1).max(512).optional(),
    }),
  }),
  z.object({
    method: z.literal('auth_link_login'),
    params: z.object({ code: z.string().min(1).max(512), address }),
  }),
  z.object({
    method: z.literal('auth_logout'),
    params: z.object({ session: z.string().min(1).max(512), address }),
  }),
  z.object({ method: z.literal('auth_oidc_info'), params: z.object({}).default({}) }),
  z.object({
    method: z.literal('auth_oidc_begin'),
    params: z.object({ returnTo: z.string().max(2048).optional() }),
  }),
  z.object({
    method: z.literal('auth_oidc_complete'),
    params: z.object({ query: z.string().max(8192), address }),
  }),
  z.object({
    method: z.literal('auth_saml_begin'),
    params: z.object({ returnTo: z.string().max(2048).optional() }),
  }),
  z.object({
    method: z.literal('auth_saml_complete'),
    params: z.object({
      samlResponse: z.string().min(1).max(1_000_000),
      relayState: z.string().max(512).default(''),
      address,
    }),
  }),
  z.object({ method: z.literal('auth_saml_metadata'), params: z.object({}).default({}) }),
  z.object({
    method: z.literal('login_link_create'),
    params: z.object({
      email,
      name: z.string().trim().min(1).max(256).optional(),
      admin: z.boolean().optional(),
      ttl: z.string().min(2).max(16).optional(),
    }),
  }),
  z.object({ method: z.literal('whoami'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('users_list'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('users_directory'), params: z.object({}).default({}) }),
  z.object({ method: z.literal('users_set'), params: z.object({ email, attributes }) }),
  z.object({ method: z.literal('users_disable'), params: z.object({ email }) }),
  z.object({ method: z.literal('users_enable'), params: z.object({ email }) }),
  z.object({ method: z.literal('tokens_list'), params: z.object({}).default({}) }),
  z.object({
    method: z.literal('tokens_create'),
    params: z.object({
      name: z.string().trim().min(1).max(128),
      ttl: z.string().min(2).max(16).optional(),
    }),
  }),
  z.object({
    method: z.literal('tokens_revoke'),
    params: z.object({ token: z.string().min(1).max(256) }),
  }),
  z.object({
    method: z.literal('cli_login_begin'),
    params: z.object({
      challenge: z.string().min(1).max(128),
      machine: z.string().min(1).max(128),
    }),
  }),
  z.object({
    method: z.literal('cli_login_approve'),
    params: z.object({
      challenge: z.string().min(1).max(128),
      machine: z.string().min(1).max(128),
    }),
  }),
  z.object({
    method: z.literal('cli_login_exchange'),
    params: z.object({
      code: z.string().min(1).max(512),
      verifier: z.string().min(1).max(256),
      address,
    }),
  }),
] as const;

/** Methods the remote transport refuses: the daemon, the panel and the workers of specialists. */
export const remoteDenied: readonly string[] = [
  'shutdown',
  'shutdown_idle',
  'web_start',
  'web_stop',
  'process_kill',
  'report',
  'message',
  'artifact_publish',
  'worker_run_show',
  'worker_queue_add',
  'worker_queue_edit',
  'worker_queue_remove',
  'mcp_remote_forward',
  'subscribe',
  'auth_resolve',
  'auth_link_login',
  'auth_logout',
  'auth_oidc_info',
  'auth_oidc_begin',
  'auth_oidc_complete',
  'auth_saml_begin',
  'auth_saml_complete',
  'auth_saml_metadata',
];

export interface UserView {
  id: string;
  email: string;
  name: string;
  attributes: Record<string, string[]>;
  source: string;
  disabled: boolean;
  admin: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

/** A user as the filters of the lists need it: no attributes, no state of the account. */
export interface UserDirectoryEntry {
  id: string;
  email: string;
  name: string;
}

export interface TokenView {
  id: string;
  name: string;
  start: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number;
}
