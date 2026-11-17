import { PROTECTED_GIT_COMMANDS, type Endpoint, type LaunchContext } from '../../types/index.ts';
import type { AttemptServers } from '../policy/index.ts';

const tomlString = (text: string): string => JSON.stringify(text);
const tomlList = (items: string[]): string => `[${items.map(tomlString).join(', ')}]`;

/** `[mcp_servers.<name>]`: the names are `aip-<uuid>` and `aip-<uuid>-<name>`, bare TOML keys. */
function serverTable(name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`MCP server name ${name} is not a TOML key`);
  return `[mcp_servers.${name}]`;
}

const SANDBOX = { read: 'read-only', edit: 'workspace-write', full: 'danger-full-access' } as const;

/**
 * The `config.toml` of the private CODEX_HOME of one attempt. The provider points at the Responses
 * API and names the variable of the key, never its value. Only the worker, the servers of the
 * specialist and the tools of the worker are registered; the file is rewritten on every attempt, so
 * nothing of an earlier worker stays.
 */
export function codexConfig(
  context: LaunchContext,
  servers: AttemptServers,
  endpoint: Endpoint | null,
): string {
  const { permissions, model } = context.specialist;
  const lines = [
    ...(model ? [`model = ${tomlString(model)}`] : []),
    ...(endpoint ? [`model_provider = "aip"`] : []),
    // read and full never ask; edit asks for what no rule allows, and nobody answers in exec
    `approval_policy = ${tomlString(permissions === 'edit' ? 'untrusted' : 'never')}`,
    `sandbox_mode = ${tomlString(SANDBOX[permissions])}`,
    '',
  ];
  if (permissions === 'edit') {
    lines.push('[sandbox_workspace_write]', 'network_access = false', '');
  }
  if (endpoint) {
    lines.push(
      '[model_providers.aip]',
      'name = "aip"',
      `base_url = ${tomlString(endpoint.baseUrl)}`,
      `env_key = ${tomlString(endpoint.keyEnv)}`,
      'wire_api = "responses"',
      '',
    );
  }
  lines.push(
    serverTable(servers.worker),
    `command = ${tomlString(servers.command)}`,
    `args = ${tomlList(servers.args)}`,
    `enabled_tools = ${tomlList(servers.tools)}`,
    '',
  );
  for (const own of servers.own) {
    lines.push(serverTable(own.name), `command = ${tomlString(own.command)}`);
    lines.push(`args = ${tomlList(own.args)}`);
    const env = Object.entries(own.env);
    if (env.length > 0) {
      lines.push(
        `env = { ${env.map(([key, value]) => `${key} = ${tomlString(value)}`).join(', ')} }`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** The tokens of a command pattern up to a trailing `*`; null for a pattern a prefix cannot express. */
function prefixOf(pattern: string): string[] | null {
  const tokens = pattern
    .trim()
    .replace(/\s*\*$/, '')
    .split(/\s+/)
    .filter(Boolean);
  return tokens.length === 0 || tokens.some((token) => token.includes('*')) ? null : tokens;
}

/**
 * The execpolicy rules of the private home: the protected git commands are forbidden at every level
 * and, for `edit`, only the prefixes of `allow_commands` run. Everything else asks, and an ask in
 * `codex exec` is a refusal. A prefix rule matches the start of the command, not the whole line.
 */
export function codexRules(context: LaunchContext): string {
  const { permissions, allowCommands } = context.specialist;
  const rule = (tokens: string[], decision: 'allow' | 'forbidden'): string =>
    `prefix_rule(pattern = ${tomlList(tokens)}, decision = ${tomlString(decision)})`;
  const lines = [...PROTECTED_GIT_COMMANDS.map((command) => rule(command.split(' '), 'forbidden'))];
  if (permissions === 'edit') {
    for (const pattern of allowCommands) {
      const tokens = prefixOf(pattern);
      if (tokens && !(tokens[0] === 'git' && PROTECTED_GIT_COMMANDS.includes(tokens.join(' '))))
        lines.push(rule(tokens, 'allow'));
    }
  }
  return `${lines.join('\n')}\n`;
}
