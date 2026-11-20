import type { Method } from '../../contract/index.ts';
import type { MethodAccess } from './method-actions.ts';
import { anywhere, project, shared } from './resource.ts';

const onProject = (action: string): MethodAccess => ({ action, target: project });
const onShared = (action: string): MethodAccess => ({ action, target: shared });
const open: MethodAccess = { action: null };

/** `level` is `global`; a missing `level` means `global` for the settings methods. */
const globalLevel = (params: { level?: unknown }): boolean =>
  (params.level ?? 'global') === 'global';
const explicitGlobal = (params: { level?: unknown }): boolean => params.level === 'global';

/** The write of the configuration: the shared level or a project, by the call. */
const writes = (
  isGlobal: (params: { level?: unknown; repository?: unknown }) => boolean,
): MethodAccess => ({
  action: (params) => (isGlobal(params) ? 'config.global.write' : 'config.write'),
  target: (params, context) => (isGlobal(params) ? shared() : project(params)),
});

/** The tags of specialists: shared without a repository. */
const specialistTags: MethodAccess = writes((params) => params.repository === null);

const reads: MethodAccess = { action: 'config.read', target: project };

/** The registry, the settings, the statistics, the integrations, the daemon and the accounts. */
export const settingsMethods = {
  repositories: { action: 'project.read', target: anywhere },
  repository_match: { action: 'project.read', target: anywhere },
  repository_add: onShared('project.add'),
  repository_update: onShared('project.update'),
  repository_move: onShared('project.update'),
  repository_remove: onShared('project.remove'),
  integration_types: onShared('integration.read'),
  integration_senders: onShared('integration.read'),
  integration_list: onShared('integration.read'),
  integration_add: onShared('integration.write'),
  integration_edit: onShared('integration.write'),
  integration_remove: onShared('integration.write'),
  notify_list: onShared('integration.read'),
  notify_log: onShared('integration.read'),
  notify_channels: onShared('integration.read'),
  notify_add: onShared('integration.write'),
  notify_edit: onShared('integration.write'),
  notify_enable: onShared('integration.write'),
  notify_disable: onShared('integration.write'),
  notify_remove: onShared('integration.write'),
  notify_test: onShared('integration.write'),
  webhook_list: onShared('integration.read'),
  webhook_log: onShared('integration.read'),
  webhook_add: onShared('integration.write'),
  webhook_edit: onShared('integration.write'),
  webhook_enable: onShared('integration.write'),
  webhook_disable: onShared('integration.write'),
  webhook_remove: onShared('integration.write'),
  webhook_test: onShared('integration.write'),
  webhook_redeliver: onShared('integration.write'),
  integration_links: onShared('integration.read'),
  integration_link: onShared('integration.write'),
  integration_enable: onShared('integration.write'),
  integration_disable: onShared('integration.write'),
  integration_check: onShared('integration.write'),
  integration_skills: onShared('integration.read'),
  integration_secret_set: onShared('integration.write'),
  integration_secret_remove: onShared('integration.write'),
  stats_report: onProject('stats.read'),
  stats_clear: onProject('stats.clear'),
  observers_history: { action: 'observers.read', target: anywhere },
  observers: { action: 'observers.read', target: anywhere },
  observers_set: onShared('config.global.write'),
  pipelines: reads,
  system_stages: reads,
  config: reads,
  config_catalog: reads,
  config_models: reads,
  config_preview: reads,
  config_providers: reads,
  provider_models: reads,
  specialist_tags: { action: 'config.read', target: anywhere },
  shared_specialists: { action: 'config.read', target: anywhere },
  shared_pipelines: { action: 'config.read', target: anywhere },
  config_write: writes(explicitGlobal),
  config_delete: writes(explicitGlobal),
  config_setting: writes(globalLevel),
  config_settings: writes(globalLevel),
  config_mcp_server: writes(globalLevel),
  specialist_tags_set: specialistTags,
  specialist_tag_rename: specialistTags,
  specialist_tag_remove: specialistTags,
  specialists_import: onShared('config.global.write'),
  pipelines_import: onShared('config.global.write'),
  processes: onShared('process.read'),
  process_kill: onShared('process.kill'),
  shutdown: onShared('daemon.control'),
  shutdown_idle: onShared('daemon.control'),
  web_start: onShared('daemon.control'),
  web_stop: onShared('daemon.control'),
  web_status: open,
  network_status: open,
  ping: open,
  subscribe: open,
  // the sign-in happens before there is a user; the tokens and the exit are the user's own
  auth_resolve: open,
  auth_link_login: open,
  auth_logout: open,
  auth_oidc_info: open,
  auth_oidc_begin: open,
  auth_oidc_complete: open,
  auth_saml_begin: open,
  auth_saml_complete: open,
  auth_saml_metadata: open,
  cli_login_begin: open,
  cli_login_approve: open,
  cli_login_exchange: open,
  whoami: open,
  tokens_list: open,
  tokens_create: open,
  tokens_revoke: open,
  login_link_create: onShared('users.manage'),
  users_list: onShared('users.manage'),
  users_directory: onShared('users.read'),
  users_set: onShared('users.manage'),
  users_disable: onShared('users.manage'),
  users_enable: onShared('users.manage'),
  audit_list: onShared('audit.read'),
  access_check: onShared('users.manage'),
  access_me: open,
  access_actions: open,
} satisfies Partial<Record<Method, MethodAccess>>;
