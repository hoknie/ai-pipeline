import { isAbsolute } from 'node:path';
import {
  type ValidateContext,
  addError,
  join,
  readBoolean,
  readEntries,
  readMapping,
  readString,
  readStrings,
} from '../validate-context.ts';
import { checkEnvironment } from '../validate-runtimes.ts';
import { parseReferences } from '../../types/mcp/reference.ts';
import {
  CONNECTION_NAME,
  type CatalogMcpServer,
  type McpServer,
  type Specialist,
} from '../../types/specialist.ts';

const MCP_SERVER_KEYS = ['command', 'args', 'env', 'connection'];

const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/;

const RESERVED_MCP_SERVER = 'aip';

/** Reports a broken `${…}` reference in a value of an MCP server. */
function checkReference(ctx: ValidateContext, value: string, path: string): void {
  const parsed = parseReferences(value);
  if ('error' in parsed) addError(ctx, path, parsed.error);
}

function checkReferences(ctx: ValidateContext, server: McpServer, path: string): void {
  server.args.forEach((arg, index) => checkReference(ctx, arg, `${path}.args[${index}]`));
  for (const [name, value] of Object.entries(server.env)) {
    checkReference(ctx, value, join(join(path, 'env'), name));
  }
}

/** Checks a map of servers by name: the field `mcp` of a specialist. */
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
      const server = checkMcpServer(ctx, field, serverPath, MCP_SERVER_KEYS);
      if (server) servers[name] = server;
    }
  }
  return servers;
}

function checkMcpServer(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  allowed: string[],
): McpServer | null {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  const server: McpServer = { command: '', args: [], env: {} };
  for (const [key, field] of readEntries(ctx, mapping, path, allowed)) {
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
    if (key === 'connection') {
      const name = readString(ctx, field, fieldPath);
      if (name === null) continue;
      // the name is never expanded: a `${…}` fails the pattern like any other wrong character
      if (CONNECTION_NAME.test(name)) server.connection = name;
      else
        addError(
          ctx,
          fieldPath,
          'must be the name of a connection: lowercase letters, digits, ".", "-" and "_"',
        );
    }
  }
  checkTransport(ctx, mapping, path);
  checkReferences(ctx, server, path);
  return server;
}

/** Exactly one of `command` and `connection`; `args` and `env` belong to a started program only. */
function checkTransport(
  ctx: ValidateContext,
  mapping: Record<string, unknown>,
  path: string,
): void {
  const hasCommand = 'command' in mapping;
  const hasConnection = 'connection' in mapping;
  if (hasCommand === hasConnection) {
    addError(ctx, path, 'exactly one of the keys `command` and `connection` is required');
  }
  if (!hasConnection) return;
  for (const key of ['args', 'env']) {
    if (key in mapping) addError(ctx, join(path, key), 'is not allowed together with `connection`');
  }
}

/** Checks `swarm.mcp_servers`: the servers by name with the flag `all_specialists`. */
export function checkMcpCatalog(
  ctx: ValidateContext,
  value: unknown,
): Record<string, CatalogMcpServer> {
  const catalog: Record<string, CatalogMcpServer> = {};
  const path = 'swarm.mcp_servers';
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return catalog;
  for (const [name, field] of Object.entries(mapping)) {
    const serverPath = join(path, name);
    if (!MCP_SERVER_NAME.test(name)) {
      addError(ctx, serverPath, 'name may contain only letters, digits, "-" and "_"');
      continue;
    }
    if (name === RESERVED_MCP_SERVER) {
      addError(ctx, serverPath, 'this name is reserved for the server of aip');
      continue;
    }
    const server = checkMcpServer(ctx, field, serverPath, [...MCP_SERVER_KEYS, 'all_specialists']);
    if (!server) continue;
    const flag = (field as Record<string, unknown>).all_specialists;
    const allSpecialists =
      flag === undefined
        ? false
        : (readBoolean(ctx, flag, join(serverPath, 'all_specialists')) ?? false);
    catalog[name] = { ...server, allSpecialists };
  }
  return catalog;
}

function plain(server: McpServer): McpServer {
  return {
    command: server.command,
    args: [...server.args],
    env: { ...server.env },
    ...(server.connection === undefined ? {} : { connection: server.connection }),
  };
}

/**
 * Gives every specialist its final set of servers: the catalog servers for all specialists, the
 * ones it names in `mcp_servers`, then its own `mcp` (the own entry wins on a clash). A name that
 * is not in the catalog is an error.
 */
export function resolveMcpServers(
  ctx: ValidateContext,
  specialists: Specialist[],
  catalog: Record<string, CatalogMcpServer>,
): void {
  const forAll = Object.entries(catalog).filter(([, server]) => server.allSpecialists);
  for (const specialist of specialists) {
    const resolved: Record<string, McpServer> = {};
    for (const [name, server] of forAll) resolved[name] = plain(server);
    (specialist.mcpServers ?? []).forEach((name, index) => {
      const server = catalog[name];
      if (server) resolved[name] = plain(server);
      else {
        const path = `swarm.specialists.${specialist.slug}.mcp_servers[${index}]`;
        const known = Object.keys(catalog);
        const hint = known.length > 0 ? `; known: ${known.join(', ')}` : '; the catalog is empty';
        addError(ctx, path, `unknown MCP server \`${name}\`${hint}`);
      }
    });
    Object.assign(resolved, specialist.mcp);
    if (Object.keys(resolved).length > 0) specialist.mcp = resolved;
  }
}
