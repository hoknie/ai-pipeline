import { isAbsolute } from 'node:path';
import {
  type ValidateContext,
  addError,
  join,
  readBoolean,
  readChoice,
  readEntries,
  readMapping,
  readString,
  readStrings,
} from './validate-context.ts';
import {
  type ChainMode,
  CHAIN_MODES,
  type ChainRuntimeItem,
  type RuntimeChain,
} from '../types/chain.ts';
import { isValidSlug, SLUG_PATTERN_TEXT } from '../types/lookups.ts';
import { type RuntimeSettings } from '../types/settings.ts';
import { type McpServer, REASONING_EFFORTS, RUNTIMES, type Runtime } from '../types/specialist.ts';

const RUNTIME_COMMAND_KEYS = ['command', 'args', 'env'];

const MCP_SERVER_KEYS = ['command', 'args', 'env'];

const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/;

const RESERVED_MCP_SERVER = 'aip';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const CHAIN_KEYS = ['name', 'mode', 'runtimes', 'enabled'];

export const CHAIN_RUNTIME_KEYS = ['runtime', 'model', 'enabled', 'variant', 'reasoning_effort'];

export function checkChains(ctx: ValidateContext, value: unknown): RuntimeChain[] {
  const mapping = readMapping(ctx, value, 'swarm.chains');
  if (!mapping) return [];
  return readEntries(ctx, mapping, 'swarm.chains', null).flatMap(([slug, field]) => {
    const path = join('swarm.chains', slug);
    if (!isValidSlug(slug)) addError(ctx, path, `slug must match ${SLUG_PATTERN_TEXT}`);
    const chain = checkChain(ctx, slug, field, path);
    return chain ? [chain] : [];
  });
}

export function checkChain(
  ctx: ValidateContext,
  slug: string,
  value: unknown,
  path: string,
): RuntimeChain | null {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  const chain: RuntimeChain = {
    slug,
    name: '',
    mode: 'on_error',
    runtimes: [],
    enabled: true,
    level: 'project',
  };
  for (const [key, field] of readEntries(ctx, mapping, path, CHAIN_KEYS)) {
    const fieldPath = join(path, key);
    if (key === 'name') chain.name = readString(ctx, field, fieldPath) ?? '';
    else if (key === 'mode')
      chain.mode = readChoice<ChainMode>(ctx, field, fieldPath, CHAIN_MODES) ?? chain.mode;
    else if (key === 'enabled') chain.enabled = readBoolean(ctx, field, fieldPath) ?? true;
    else if (key === 'runtimes') chain.runtimes = checkChainRuntimes(ctx, field, fieldPath);
  }
  if (!('name' in mapping)) addError(ctx, join(path, 'name'), 'is required');
  if (!('mode' in mapping)) addError(ctx, join(path, 'mode'), 'is required');
  if (!('runtimes' in mapping)) addError(ctx, join(path, 'runtimes'), 'is required');
  return chain;
}

function checkChainRuntimes(
  ctx: ValidateContext,
  value: unknown,
  path: string,
): ChainRuntimeItem[] {
  if (!Array.isArray(value)) {
    addError(ctx, path, 'must be a list');
    return [];
  }
  if (value.length === 0) {
    addError(ctx, path, 'must not be empty');
    return [];
  }
  const items: ChainRuntimeItem[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    const itemPath = `${path}[${index}]`;
    const mapping = readMapping(ctx, item, itemPath);
    if (!mapping) continue;
    const runtimeItem: ChainRuntimeItem = { runtime: 'claude', model: null, enabled: true };
    for (const [key, field] of readEntries(ctx, mapping, itemPath, CHAIN_RUNTIME_KEYS)) {
      const fieldPath = join(itemPath, key);
      if (key === 'runtime') {
        runtimeItem.runtime =
          readChoice<Runtime>(ctx, field, fieldPath, RUNTIMES) ?? runtimeItem.runtime;
      } else if (key === 'model') runtimeItem.model = readString(ctx, field, fieldPath);
      else if (key === 'enabled') runtimeItem.enabled = readBoolean(ctx, field, fieldPath) ?? true;
    }
    if (!('runtime' in mapping)) addError(ctx, join(itemPath, 'runtime'), 'is required');
    checkChainRuntimeOpencode(ctx, mapping, itemPath, runtimeItem);
    items.push(runtimeItem);
  }
  return items;
}

function checkChainRuntimeOpencode(
  ctx: ValidateContext,
  mapping: Record<string, unknown>,
  path: string,
  item: ChainRuntimeItem,
): void {
  for (const key of ['variant', 'reasoning_effort'] as const) {
    if (!(key in mapping)) continue;
    const fieldPath = join(path, key);
    if (item.runtime !== 'opencode') {
      addError(ctx, fieldPath, 'is supported by the opencode runtime only');
    }
    if (key === 'variant') {
      const variant = readString(ctx, mapping[key], fieldPath);
      if (variant !== null) item.variant = variant.trim();
    } else {
      const effort = readChoice(ctx, mapping[key], fieldPath, REASONING_EFFORTS);
      if (effort !== null) item.reasoningEffort = effort;
    }
  }
}

export function checkRuntimes(
  ctx: ValidateContext,
  value: unknown,
  runtimes: RuntimeSettings,
): void {
  const mapping = readMapping(ctx, value, 'swarm.runtimes');
  if (!mapping) return;
  for (const [name, section] of readEntries(ctx, mapping, 'swarm.runtimes', [...RUNTIMES])) {
    const base = join('swarm.runtimes', name);
    const entry = readMapping(ctx, section, base);
    if (!entry) continue;
    const target = runtimes[name as Runtime];
    for (const [key, field] of readEntries(ctx, entry, base, RUNTIME_COMMAND_KEYS)) {
      const path = join(base, key);
      if (key === 'command') {
        const command = readString(ctx, field, path);
        if (command === null) continue;
        if (command.includes('/') && !isAbsolute(command)) {
          addError(ctx, path, 'must be a command name or an absolute path');
        } else target.command = command;
      }
      if (key === 'args') target.args = readStrings(ctx, field, path);
      if (key === 'env') target.env = checkEnvironment(ctx, field, path);
    }
  }
}

export function checkEnvironment(
  ctx: ValidateContext,
  value: unknown,
  path: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return result;
  for (const [name, field] of Object.entries(mapping)) {
    const fieldPath = join(path, name);
    if (!ENV_NAME.test(name)) {
      addError(ctx, fieldPath, 'must be a valid variable name');
      continue;
    }
    if (typeof field !== 'string') addError(ctx, fieldPath, 'must be a string');
    else result[name] = field;
  }
  return result;
}

export function checkMcpServers(
  ctx: ValidateContext,
  value: unknown,
  path: string,
): Record<string, McpServer> {
  const servers: Record<string, McpServer> = {};
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return servers;
  for (const [name, field] of Object.entries(mapping)) {
    const serverPath = join(path, name);
    if (!MCP_SERVER_NAME.test(name)) {
      addError(ctx, serverPath, 'name may contain only letters, digits, "-" and "_"');
    } else if (name === RESERVED_MCP_SERVER) {
      addError(ctx, serverPath, 'this name is reserved for the server of aip');
    } else {
      const server = checkMcpServer(ctx, field, serverPath);
      if (server) servers[name] = server;
    }
  }
  return servers;
}

export function checkMcpServer(
  ctx: ValidateContext,
  value: unknown,
  path: string,
): McpServer | null {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  const server: McpServer = { command: '', args: [], env: {} };
  for (const [key, field] of readEntries(ctx, mapping, path, MCP_SERVER_KEYS)) {
    const fieldPath = join(path, key);
    if (key === 'command') {
      const command = readString(ctx, field, fieldPath);
      if (command === null) continue;
      if (command.includes('/') && !isAbsolute(command)) {
        addError(ctx, fieldPath, 'must be a command name or an absolute path');
      } else server.command = command;
    }
    if (key === 'args') server.args = readStrings(ctx, field, fieldPath);
    if (key === 'env') server.env = checkEnvironment(ctx, field, fieldPath);
  }
  if (!('command' in mapping)) addError(ctx, join(path, 'command'), 'is required');
  return server;
}
