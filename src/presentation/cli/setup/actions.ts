import { homedir } from 'node:os';
import { join } from 'node:path';

import { setupFailure } from '../io.ts';

import { failure, hostBinary } from './host.ts';
import type { CheckResult, SetupAction, SetupDeps } from './types.ts';

export function prerequisites(deps: SetupDeps): SetupAction {
  return {
    id: 'prerequisites',
    label: 'Node.js and git',
    plan: 'check Node.js 24 or newer and git',
    check: async () => {
      const major = Number(process.versions.node.split('.')[0]);
      if (major < 24) {
        return {
          state: 'error',
          reason: `Node.js ${process.versions.node} found, 24 or newer is required`,
        };
      }
      if (!deps.find('git')) return { state: 'error', reason: 'git not found in PATH' };
      return { state: 'configured' };
    },
    apply: async () => undefined,
  };
}

/** `Command: x` and `Args: y z` of `claude mcp get`, joined. */
function registeredCommand(output: string): string {
  const command = /^\s*Command:\s*(.*)$/m.exec(output)?.[1]?.trim() ?? '';
  const args = /^\s*Args:\s*(.*)$/m.exec(output)?.[1]?.trim() ?? '';
  return [command, args].filter(Boolean).join(' ');
}

export function claudeMcp(deps: SetupDeps, command: string[]): SetupAction {
  const wanted = [...command, 'mcp'];
  const manual = `claude mcp add --scope user aip -- ${wanted.join(' ')}`;
  return {
    id: 'claude-mcp',
    label: 'Claude Code: MCP server',
    plan: `run \`${manual}\``,
    check: async () => {
      const bin = hostBinary(deps, 'AIP_CLAUDE_BIN', 'claude');
      if (!bin) return { state: 'skip', reason: 'claude not found in PATH' };
      const result = await deps.exec(bin, ['mcp', 'get', 'aip']);
      if (result.code !== 0) return { state: 'missing' };
      const current = registeredCommand(result.stdout);
      return current === wanted.join(' ')
        ? { state: 'configured' }
        : {
            state: 'differs',
            detail: `already registered as \`${current}\`; use --force to replace it`,
          };
    },
    apply: async (replace) => {
      const bin = hostBinary(deps, 'AIP_CLAUDE_BIN', 'claude')!;
      if (replace) await deps.exec(bin, ['mcp', 'remove', '--scope', 'user', 'aip']);
      const result = await deps.exec(bin, [
        'mcp',
        'add',
        '--scope',
        'user',
        'aip',
        '--',
        ...wanted,
      ]);
      if (result.code !== 0) throw setupFailure(`${failure(result)} (manual: ${manual})`);
    },
  };
}

export function claudePlugin(deps: SetupDeps): SetupAction {
  const marketplace = deps.root;
  const manual = `claude plugin marketplace add ${marketplace} && claude plugin install aip@aip`;
  const fallback = 'or start Claude Code with --plugin-dir <aip>/integrations/claude-code';
  let outdated = false;
  /** The version in this installation's plugin manifest, or null when it cannot be read. */
  const wantedVersion = (): string | null => {
    const text = deps.readFile(
      join(marketplace, 'integrations', 'claude-code', '.claude-plugin', 'plugin.json'),
    );
    try {
      const version: unknown = text === null ? null : JSON.parse(text).version;
      return typeof version === 'string' ? version : null;
    } catch {
      return null;
    }
  };
  return {
    id: 'claude-plugin',
    label: 'Claude Code: aip plugin',
    plan: `run \`${manual}\``,
    check: async () => {
      const bin = hostBinary(deps, 'AIP_CLAUDE_BIN', 'claude');
      if (!bin) return { state: 'skip', reason: 'claude not found in PATH' };
      if (!deps.exists(join(marketplace, '.claude-plugin', 'marketplace.json'))) {
        return { state: 'skip', reason: `no plugin manifest in ${marketplace}; ${fallback}` };
      }
      const result = await deps.exec(bin, ['plugin', 'list']);
      if (result.code !== 0) {
        return {
          state: 'skip',
          reason: `this Claude Code has no \`claude plugin\`; install by hand: ${manual}; ${fallback}`,
        };
      }
      outdated = false;
      const listed = /\baip@aip\b/.exec(result.stdout);
      if (!listed) return { state: 'missing' };
      // Claude Code keeps its own copy of the plugin: after a package update it can be old.
      const rest = result.stdout.slice(listed.index + listed[0].length);
      const entry = rest.split(/\r?\n(?=\S*\s*[\w.-]+@[\w.-]+\s*$)/m)[0] ?? '';
      const installed = /Version:\s*v?(\S+)/i.exec(entry)?.[1];
      const wanted = wantedVersion();
      if (installed && wanted && installed !== wanted) {
        outdated = true;
        return { state: 'missing' };
      }
      return { state: 'configured' };
    },
    apply: async () => {
      const bin = hostBinary(deps, 'AIP_CLAUDE_BIN', 'claude')!;
      if (outdated) {
        const manualUpdate = 'claude plugin marketplace update aip && claude plugin update aip@aip';
        const refreshed = await deps.exec(bin, ['plugin', 'marketplace', 'update', 'aip']);
        if (refreshed.code !== 0)
          throw setupFailure(`${failure(refreshed)} (manual: ${manualUpdate})`);
        const updated = await deps.exec(bin, ['plugin', 'update', 'aip@aip']);
        if (updated.code !== 0) throw setupFailure(`${failure(updated)} (manual: ${manualUpdate})`);
        return;
      }
      const added = await deps.exec(bin, ['plugin', 'marketplace', 'add', marketplace]);
      if (added.code !== 0 && !/already/i.test(added.stderr + added.stdout)) {
        throw setupFailure(`${failure(added)} (manual: ${manual})`);
      }
      const installed = await deps.exec(bin, ['plugin', 'install', 'aip@aip']);
      if (installed.code !== 0) throw setupFailure(`${failure(installed)} (manual: ${manual})`);
    },
  };
}

export function opencodeConfigPath(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(base, 'opencode', 'opencode.json');
}

export function opencodeMcp(deps: SetupDeps, command: string[]): SetupAction {
  const wanted = [...command, 'mcp'];
  const path = opencodeConfigPath(deps.env);
  const entry = { type: 'local', command: wanted, enabled: true };
  const snippet = JSON.stringify({ mcp: { aip: entry } }, null, 2);
  const unparsable = (why: string): CheckResult => ({
    state: 'skip',
    reason: `${why}; add this to it by hand:\n${snippet}`,
  });
  function read(): { config: Record<string, any> } | CheckResult {
    const text = deps.readFile(path);
    if (text === null) {
      return deps.exists(`${path}c`)
        ? unparsable(`${path}c has comments and is left alone`)
        : { config: {} };
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return unparsable(`${path} is not a JSON object`);
      }
      return { config: parsed as Record<string, any> };
    } catch {
      return unparsable(`${path} is not valid JSON`);
    }
  }
  return {
    id: 'opencode-mcp',
    label: 'OpenCode: MCP server',
    plan: `add \`mcp.aip\` to ${path}`,
    check: async () => {
      if (!hostBinary(deps, 'AIP_OPENCODE_BIN', 'opencode')) {
        return { state: 'skip', reason: 'opencode not found in PATH' };
      }
      const loaded = read();
      if (!('config' in loaded)) return loaded;
      const current = loaded.config.mcp?.aip;
      if (current === undefined) return { state: 'missing' };
      return JSON.stringify(current.command) === JSON.stringify(wanted)
        ? { state: 'configured' }
        : {
            state: 'differs',
            detail: `${path} already has mcp.aip with another command; use --force to replace it`,
          };
    },
    apply: async () => {
      const loaded = read();
      if (!('config' in loaded)) throw setupFailure('the configuration changed while setup ran');
      const config = loaded.config;
      config.mcp = { ...(config.mcp ?? {}), aip: entry };
      if (config.$schema === undefined) config.$schema = 'https://opencode.ai/config.json';
      deps.writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
    },
  };
}
