import {
  type ValidateContext,
  addError,
  join,
  type Range,
  readBoolean,
  readChoice,
  readEntries,
  readInteger,
  readKnown,
  readMapping,
  readString,
  readStrings,
  readTimeout,
} from './validate-context.ts';
import {
  CLAUDE_EDIT_MODES,
  CLAUDE_MCP_MODES,
  CLAUDE_SETTINGS_SOURCES,
  type ClaudeEditMode,
  type ClaudeMcpMode,
  type ClaudeSettings,
  type ClaudeSettingsSource,
  DELIVERY_MODES,
  type DeliveryMode,
  type DeliverySettings,
  type NamingSettings,
  WEB_AUTH_MODES,
  WEB_HOSTS,
  type WebAuth,
  type WebHost,
  type WebSettings,
  WORKSPACE_BASES,
  type WorkspaceBase,
  type WorkspaceSettings,
} from '../types/settings.ts';
import {
  type Defaults,
  type Permissions,
  PERMISSIONS,
  type Runtime,
  RUNTIMES,
} from '../types/specialist.ts';

const CLAUDE_KEYS = ['edit_mode', 'mcp', 'settings'];

const DELIVERY_KEYS = [
  'mode',
  'auto',
  'keep',
  'commit_message',
  'message_specialist',
  'resolver',
  'resolver_rounds',
  'message_prompt',
  'resolver_prompt',
];

const WORKSPACE_KEYS = ['base', 'include'];

const WEB_KEYS = ['autostart', 'auth', 'port', 'host'];

const WEB_PORT_RANGE: Range = [1, 65535];

const NAMING_KEYS = ['enabled', 'runtime', 'model'];

const RESOLVER_ROUNDS_RANGE: Range = [1, 10];

const DEFAULTS_KEYS = ['runtime', 'permissions', 'timeout', 'allow_commands', 'tools'];

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .replace(/^(\.\/)+/, '');
}

function includeProblem(entry: string, workspaceDir: string): string | null {
  const path = normalizePath(entry);
  if (path === '' || path === '.') return 'must name a path inside the repository, not the root';
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split('/').includes('..')) {
    return 'must be a path inside the repository';
  }
  const workspace = normalizePath(workspaceDir);
  if (path === workspace || path.startsWith(`${workspace}/`)) {
    return `must not point inside workspace_dir (${workspaceDir})`;
  }
  return null;
}

export function checkDelivery(
  ctx: ValidateContext,
  value: unknown,
  delivery: DeliverySettings,
  known: string[],
): void {
  const mapping = readMapping(ctx, value, 'swarm.delivery');
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, 'swarm.delivery', DELIVERY_KEYS)) {
    const path = join('swarm.delivery', key);
    if (key === 'mode') {
      delivery.mode = readChoice<DeliveryMode>(ctx, field, path, DELIVERY_MODES) ?? delivery.mode;
    }
    if (key === 'auto') delivery.auto = readBoolean(ctx, field, path) ?? delivery.auto;
    if (key === 'keep') delivery.keep = readBoolean(ctx, field, path) ?? delivery.keep;
    if (key === 'commit_message') {
      delivery.commitMessage = readString(ctx, field, path) ?? delivery.commitMessage;
    }
    if (key === 'message_specialist')
      delivery.messageSpecialist = readKnown(ctx, field, path, known);
    if (key === 'resolver') delivery.resolver = readKnown(ctx, field, path, known);
    if (key === 'resolver_rounds') {
      delivery.resolverRounds =
        readInteger(ctx, field, path, RESOLVER_ROUNDS_RANGE) ?? delivery.resolverRounds;
    }
    if (key === 'message_prompt') {
      const prompt = readString(ctx, field, path);
      if (prompt !== null) delivery.messagePrompt = prompt;
    }
    if (key === 'resolver_prompt') {
      const prompt = readString(ctx, field, path);
      if (prompt !== null) delivery.resolverPrompt = prompt;
    }
  }
}

export function checkWeb(ctx: ValidateContext, value: unknown, web: WebSettings): void {
  const mapping = readMapping(ctx, value, 'swarm.web');
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, 'swarm.web', WEB_KEYS)) {
    const path = join('swarm.web', key);
    if (key === 'autostart') web.autostart = readBoolean(ctx, field, path) ?? web.autostart;
    if (key === 'auth')
      web.auth = readChoice<WebAuth>(ctx, field, path, WEB_AUTH_MODES) ?? web.auth;
    if (key === 'port') web.port = readInteger(ctx, field, path, WEB_PORT_RANGE) ?? web.port;
    if (key === 'host') web.host = readChoice<WebHost>(ctx, field, path, WEB_HOSTS) ?? web.host;
  }
}

export function checkNaming(ctx: ValidateContext, value: unknown, naming: NamingSettings): void {
  const mapping = readMapping(ctx, value, 'swarm.naming');
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, 'swarm.naming', NAMING_KEYS)) {
    const path = join('swarm.naming', key);
    if (key === 'enabled') naming.enabled = readBoolean(ctx, field, path) ?? naming.enabled;
    if (key === 'runtime')
      naming.runtime = readChoice<Runtime>(ctx, field, path, RUNTIMES) ?? naming.runtime;
    if (key === 'model') naming.model = readString(ctx, field, path) ?? naming.model;
  }
}

export function checkWorkspace(
  ctx: ValidateContext,
  value: unknown,
  workspace: WorkspaceSettings,
  workspaceDir: string,
): void {
  const mapping = readMapping(ctx, value, 'swarm.workspace');
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, 'swarm.workspace', WORKSPACE_KEYS)) {
    const path = join('swarm.workspace', key);
    if (key === 'base') {
      workspace.base =
        readChoice<WorkspaceBase>(ctx, field, path, WORKSPACE_BASES) ?? workspace.base;
    }
    if (key === 'include') {
      const paths = readStrings(ctx, field, path);
      paths.forEach((entry, index) => {
        const problem = includeProblem(entry, workspaceDir);
        if (problem) addError(ctx, `${path}[${index}]`, problem);
      });
      workspace.include = paths;
    }
  }
}

export function checkDefaults(ctx: ValidateContext, value: unknown, defaults: Defaults): void {
  const mapping = readMapping(ctx, value, 'swarm.defaults');
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, 'swarm.defaults', DEFAULTS_KEYS)) {
    const path = join('swarm.defaults', key);
    if (key === 'runtime')
      defaults.runtime = readChoice<Runtime>(ctx, field, path, RUNTIMES) ?? defaults.runtime;
    if (key === 'permissions')
      defaults.permissions =
        readChoice<Permissions>(ctx, field, path, PERMISSIONS) ?? defaults.permissions;
    if (key === 'timeout')
      defaults.timeoutSeconds = readTimeout(ctx, field, path) ?? defaults.timeoutSeconds;
    if (key === 'allow_commands') defaults.allowCommands = readStrings(ctx, field, path);
    if (key === 'tools') defaults.tools = readStrings(ctx, field, path);
  }
}

export function checkClaude(ctx: ValidateContext, value: unknown, claude: ClaudeSettings): void {
  const mapping = readMapping(ctx, value, 'swarm.claude');
  if (!mapping) return;
  readEntries(ctx, mapping, 'swarm.claude', CLAUDE_KEYS);
  if ('edit_mode' in mapping) {
    claude.editMode =
      readChoice<ClaudeEditMode>(
        ctx,
        mapping.edit_mode,
        'swarm.claude.edit_mode',
        CLAUDE_EDIT_MODES,
      ) ?? claude.editMode;
  }
  if ('mcp' in mapping) {
    claude.mcp =
      readChoice<ClaudeMcpMode>(ctx, mapping.mcp, 'swarm.claude.mcp', CLAUDE_MCP_MODES) ??
      claude.mcp;
  }
  if ('settings' in mapping) {
    claude.settings =
      readChoice<ClaudeSettingsSource>(
        ctx,
        mapping.settings,
        'swarm.claude.settings',
        CLAUDE_SETTINGS_SOURCES,
      ) ?? claude.settings;
  }
}
