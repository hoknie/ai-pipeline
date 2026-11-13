import { assembleLevel, parseYaml } from '../../../swarm-config/services/index.ts';
import {
  type ConfigPaths,
  type ConfigSource,
  type FieldError,
  isMapping,
} from '../../../swarm-config/types/index.ts';
import { readText, revisionOf, settingsFile } from '../../repositories/documents.ts';
import {
  ConfigEditError,
  key,
  type EditPlan,
  type McpServerRequest,
  type McpServerValue,
} from '../../types/editor.ts';
import { readLevels, resolution } from '../levels.ts';
import { editSetting } from '../plan-settings.ts';

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/** The value of a variable that the file of the level already has for the server. */
function storedEnvironment(text: string | undefined, file: string, name: string) {
  if (text === undefined || text.trim() === '') return {};
  const root = parseYaml(text, file);
  const servers = isMapping(root) ? root.mcp_servers : undefined;
  const server = isMapping(servers) ? servers[name] : undefined;
  const env = isMapping(server) ? server.env : undefined;
  return isMapping(env) ? env : {};
}

/** The node of the file: empty `args`, `env` and a false `all_specialists` are left out. */
function nodeOf(
  value: McpServerValue,
  stored: Record<string, unknown>,
): { node: Record<string, unknown> } | { missing: string } {
  const env: Record<string, string> = {};
  for (const [variable, given] of Object.entries(value.env)) {
    const kept = given ?? stored[variable];
    if (typeof kept !== 'string') return { missing: variable };
    env[variable] = kept;
  }
  return {
    node: {
      command: value.command,
      ...(value.args.length > 0 ? { args: value.args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(value.allSpecialists ? { all_specialists: true } : {}),
    },
  };
}

/**
 * Checks a write or a removal of one server of the catalog without writing: the name, the
 * revision, then the whole configuration with the edited file. A variable sent without a value
 * keeps the value of the file. Errors that the configuration already had do not count.
 */
export function planMcpServer(paths: ConfigPaths, request: McpServerRequest): EditPlan {
  const { name, value, level } = request;
  if (!SERVER_NAME.test(name) || name === 'aip') {
    throw new ConfigEditError(`MCP server name \`${name}\` is not allowed`);
  }
  const file = settingsFile(paths, level);
  const path = `swarm.mcp_servers.${name}`;
  const current = readText(file);
  if (revisionOf(current) !== request.revision) {
    return {
      ok: false,
      reason: 'conflict',
      message:
        current === undefined
          ? `${file} does not exist any more`
          : request.revision === null
            ? `${file} already exists`
            : `${file} was changed after it was read`,
    };
  }
  let text: string;
  try {
    if (value === null) text = editSetting(current, `mcp_servers.${name}`, null);
    else {
      const built = nodeOf(value, storedEnvironment(current, file, name));
      if ('missing' in built) {
        const message = 'has no value in the file to keep: enter it';
        return {
          ok: false,
          reason: 'invalid',
          errors: [{ file, path: `${path}.env.${built.missing}`, message }],
        };
      }
      text = editSetting(current, `mcp_servers.${name}`, built.node);
    }
  } catch (error) {
    if (!(error instanceof ConfigEditError)) throw error;
    return { ok: false, reason: 'invalid', errors: [{ file, path, message: error.message }] };
  }
  const files = readLevels(paths);
  const before = resolution(assembleLevel(files.global), assembleLevel(files.project));
  const settings: ConfigSource = { path: file, value: parseYaml(text, file), text };
  const drafted = { ...files, [level]: { ...files[level], settings } };
  const after = resolution(assembleLevel(drafted.global), assembleLevel(drafted.project));
  const known = new Set(before.errors.map(key));
  const added: FieldError[] = after.errors.filter((error) => !known.has(key(error)));
  if (added.length > 0) return { ok: false, reason: 'invalid', errors: added };
  return { ok: true, file, text, revision: revisionOf(text) };
}
