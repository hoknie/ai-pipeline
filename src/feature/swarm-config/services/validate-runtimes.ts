import { isAbsolute } from 'node:path';
import {
  type ValidateContext,
  addError,
  join,
  readEntries,
  readMapping,
  readString,
  readStrings,
} from './validate-context.ts';
import { type RuntimeSettings } from '../types/settings.ts';
import { type McpServer, RUNTIMES, type Runtime } from '../types/specialist.ts';

const RUNTIME_COMMAND_KEYS = ['command', 'args', 'env'];

const MCP_SERVER_KEYS = ['command', 'args', 'env'];

const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/;

const RESERVED_MCP_SERVER = 'aip';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
