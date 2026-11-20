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
  DELIVERY_MODES,
  type DeliveryMode,
  type DeliverySettings,
  type NamingSettings,
  type NetworkSettings,
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
  modelIdProblem,
} from '../types/specialist.ts';

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
  'push',
  'remote',
  'base_branch',
];

const WORKSPACE_KEYS = ['base', 'include'];

const WEB_KEYS = ['autostart', 'auth', 'port', 'host', 'public_url'];

const WEB_PORT_RANGE: Range = [1, 65535];

const NETWORK_KEYS = ['enabled', 'targets', 'interfaces', 'proxy', 'interval', 'timeout'];

const NETWORK_INTERVAL_RANGE: Range = [5, 3600];

const NETWORK_TIMEOUT_RANGE: Range = [1, 60];

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

/** Why the server mode does not deliver in `mode`: the clone of the server has no working tree to write to. */
export function serverModeProblem(mode: string): string {
  return `\`${mode}\` is not allowed in the server mode: the result is delivered as a branch (\`branch\`); apply it on your machine with \`aip run apply\``;
}

export function checkDelivery(
  ctx: ValidateContext,
  value: unknown,
  delivery: DeliverySettings,
  known: string[],
  serverMode = false,
): void {
  const mapping = readMapping(ctx, value, 'swarm.delivery');
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, 'swarm.delivery', DELIVERY_KEYS)) {
    const path = join('swarm.delivery', key);
    if (key === 'mode') {
      const mode = readChoice<DeliveryMode>(ctx, field, path, DELIVERY_MODES);
      if (mode !== null && serverMode && mode !== 'branch') {
        addError(ctx, path, serverModeProblem(mode));
      } else delivery.mode = mode ?? delivery.mode;
    }
    if (key === 'push') delivery.push = readBoolean(ctx, field, path) ?? delivery.push;
    if (key === 'remote') delivery.remote = readString(ctx, field, path) ?? delivery.remote;
    if (key === 'base_branch') {
      const branch = readString(ctx, field, path);
      if (branch !== null) delivery.baseBranch = branch;
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
    if (key === 'public_url') web.publicUrl = readPublicUrl(ctx, field, path) ?? web.publicUrl;
  }
}

/** An absolute http(s) address without login, query and fragment, kept without the trailing `/`. */
function readPublicUrl(ctx: ValidateContext, value: unknown, path: string): string | null {
  const text = readString(ctx, value, path);
  if (text === null) return null;
  const refuse = (message: string): null => {
    addError(ctx, path, message);
    return null;
  };
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return refuse('must be an absolute http:// or https:// address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return refuse('must start with http:// or https://');
  }
  if (url.username !== '' || url.password !== '')
    return refuse('must not contain a login or a password');
  if (text.includes('?') || text.includes('#'))
    return refuse('must not contain a query or a fragment');
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

export function checkNaming(ctx: ValidateContext, value: unknown, naming: NamingSettings): void {
  const mapping = readMapping(ctx, value, 'swarm.naming');
  if (!mapping) return;
  let modelWasValid = true;
  for (const [key, field] of readEntries(ctx, mapping, 'swarm.naming', NAMING_KEYS)) {
    const path = join('swarm.naming', key);
    if (key === 'enabled') naming.enabled = readBoolean(ctx, field, path) ?? naming.enabled;
    if (key === 'runtime')
      naming.runtime = readChoice<Runtime>(ctx, field, path, RUNTIMES) ?? naming.runtime;
    if (key === 'model') {
      const errorsBeforeRead = ctx.errors.length;
      const model = readString(ctx, field, path);
      modelWasValid = ctx.errors.length === errorsBeforeRead;
      if (model !== null) naming.model = model;
    }
  }
  if (naming.enabled && modelWasValid) {
    const modelProblem = modelIdProblem(naming.runtime, naming.model);
    if (modelProblem) addError(ctx, 'swarm.naming.model', modelProblem);
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

/** Why `target` is not `host:port` or an `http(s)://` URL, or null when it is. */
export function networkTargetProblem(target: string): string | null {
  if (/^https?:\/\//i.test(target)) {
    try {
      return new URL(target).hostname === '' ? 'must be host:port or an http(s):// URL' : null;
    } catch {
      return 'must be host:port or an http(s):// URL';
    }
  }
  const match = /^(\[[^\]\s]+\]|[^\s:/\[\]]+):(\d+)$/.exec(target);
  const port = match?.[2] === undefined ? 0 : Number(match[2]);
  return port >= 1 && port <= 65535 ? null : 'must be host:port or an http(s):// URL';
}

function proxyProblem(proxy: string): string | null {
  try {
    const url = new URL(proxy);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '') return null;
  } catch {
    // reported below
  }
  return 'must be an http:// or https:// URL';
}

export function checkNetwork(ctx: ValidateContext, value: unknown, network: NetworkSettings): void {
  const mapping = readMapping(ctx, value, 'swarm.network');
  if (!mapping) return;
  for (const [key, field] of readEntries(ctx, mapping, 'swarm.network', NETWORK_KEYS)) {
    const path = join('swarm.network', key);
    if (key === 'enabled') network.enabled = readBoolean(ctx, field, path) ?? network.enabled;
    if (key === 'targets') {
      const targets = readStrings(ctx, field, path);
      targets.forEach((target, index) => {
        const problem = networkTargetProblem(target);
        if (problem) addError(ctx, `${path}[${index}]`, problem);
      });
      network.targets = targets;
    }
    if (key === 'interfaces') network.interfaces = readStrings(ctx, field, path);
    if (key === 'proxy') {
      const proxy = readString(ctx, field, path);
      if (proxy !== null) {
        const problem = proxyProblem(proxy);
        if (problem) addError(ctx, path, problem);
        else network.proxy = proxy;
      }
    }
    if (key === 'interval') {
      network.interval = readInteger(ctx, field, path, NETWORK_INTERVAL_RANGE) ?? network.interval;
    }
    if (key === 'timeout') {
      network.timeout = readInteger(ctx, field, path, NETWORK_TIMEOUT_RANGE) ?? network.timeout;
    }
  }
}
