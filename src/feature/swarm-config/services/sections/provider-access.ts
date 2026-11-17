import { isAbsolute } from 'node:path';
import { checkModels, type ModelsRules } from './provider-models.ts';
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
} from '../validate-context.ts';
import {
  type AccessEndpoint,
  type ApiAccess,
  type CliAccess,
  type ProviderAccess,
} from '../../types/providers/provider.ts';
import { RUNTIMES, type Runtime } from '../../types/specialist.ts';

const ACCESS_KINDS = ['cli', 'api'] as const;

const CLI_KEYS = [
  'kind',
  'runtime',
  'enabled',
  'model_prefix',
  'endpoint',
  'command',
  'args',
  'models',
];

const API_KEYS = ['kind', 'enabled', 'endpoint', 'models'];

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Runtimes that take a base URL and a key from the route. */
const ENDPOINT_RUNTIMES: readonly Runtime[] = ['claude', 'codex', 'kilo', 'cline', 'copilot'];

/** Runtimes that name the provider of a model by a prefix. */
const PREFIX_RUNTIMES: readonly Runtime[] = ['opencode', 'kilo'];

function checkEndpoint(ctx: ValidateContext, value: unknown, path: string): AccessEndpoint | null {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  let baseUrl: string | null = null;
  let keyEnv: string | null = null;
  for (const [key, field] of readEntries(ctx, mapping, path, ['base_url', 'key_env'])) {
    const fieldPath = join(path, key);
    const text = readString(ctx, field, fieldPath);
    if (text === null) continue;
    if (key === 'base_url') {
      if (/^https?:\/\/\S+$/.test(text)) baseUrl = text;
      else addError(ctx, fieldPath, 'must be an http:// or https:// URL');
    } else if (ENV_NAME.test(text)) keyEnv = text;
    else addError(ctx, fieldPath, 'must be the name of an environment variable, not a key');
  }
  for (const key of ['base_url', 'key_env']) {
    if (!(key in mapping)) addError(ctx, join(path, key), 'is required');
  }
  return baseUrl !== null && keyEnv !== null ? { baseUrl, keyEnv } : null;
}

function prefixProblem(prefix: string): string | null {
  if (/\s/.test(prefix) || prefix.startsWith('/') || prefix.endsWith('/')) {
    return 'must not contain spaces or start or end with `/`';
  }
  return null;
}

function checkCliCommand(
  ctx: ValidateContext,
  key: 'command' | 'args',
  field: unknown,
  path: string,
  access: CliAccess,
): void {
  if (key === 'args') {
    access.args = readStrings(ctx, field, path);
    return;
  }
  const command = readString(ctx, field, path);
  if (command === null) return;
  if (command.includes('/') && !isAbsolute(command)) {
    addError(ctx, path, 'must be a command name or an absolute path');
  } else access.command = command;
}

function checkCli(
  ctx: ValidateContext,
  mapping: Record<string, unknown>,
  path: string,
  rules: ModelsRules,
): CliAccess {
  const access: CliAccess = { kind: 'cli', runtime: 'claude', enabled: true, models: {} };
  if (!('runtime' in mapping)) addError(ctx, join(path, 'runtime'), 'is required');
  else {
    const runtime = readChoice<Runtime>(ctx, mapping.runtime, join(path, 'runtime'), RUNTIMES);
    if (runtime !== null) access.runtime = runtime;
  }
  for (const [key, field] of readEntries(ctx, mapping, path, CLI_KEYS)) {
    const fieldPath = join(path, key);
    if (key === 'enabled') access.enabled = readBoolean(ctx, field, fieldPath) ?? true;
    else if (key === 'runtime') continue;
    else if (key === 'model_prefix') {
      const prefix = readString(ctx, field, fieldPath);
      const problem = prefix === null ? null : prefixProblem(prefix);
      if (!PREFIX_RUNTIMES.includes(access.runtime)) {
        addError(ctx, fieldPath, 'is supported by the opencode and kilo runtimes only');
      } else if (problem !== null) addError(ctx, fieldPath, problem);
      else if (prefix !== null) access.modelPrefix = prefix;
    } else if (key === 'endpoint') {
      if (!ENDPOINT_RUNTIMES.includes(access.runtime)) {
        addError(ctx, fieldPath, `is not supported by the ${access.runtime} runtime`);
      } else {
        const endpoint = checkEndpoint(ctx, field, fieldPath);
        if (endpoint !== null) access.endpoint = endpoint;
      }
    } else if (key === 'command' || key === 'args')
      checkCliCommand(ctx, key, field, fieldPath, access);
    else if (key === 'models') access.models = checkModels(ctx, field, fieldPath, rules);
  }
  return access;
}

function checkApi(
  ctx: ValidateContext,
  mapping: Record<string, unknown>,
  path: string,
  rules: ModelsRules,
): ApiAccess {
  const access: ApiAccess = { kind: 'api', enabled: true, models: {} };
  for (const [key, field] of readEntries(ctx, mapping, path, API_KEYS)) {
    const fieldPath = join(path, key);
    if (key === 'enabled') access.enabled = readBoolean(ctx, field, fieldPath) ?? true;
    else if (key === 'endpoint') {
      const endpoint = checkEndpoint(ctx, field, fieldPath);
      if (endpoint !== null) access.endpoint = endpoint;
    } else if (key === 'models') access.models = checkModels(ctx, field, fieldPath, rules);
  }
  return access;
}

/** The `access` list of a provider; an element with a wrong `kind` is dropped after the error. */
export function checkAccess(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  rules: ModelsRules,
): ProviderAccess[] {
  if (!Array.isArray(value)) {
    addError(ctx, path, 'must be a list');
    return [];
  }
  if (value.length === 0) {
    addError(ctx, path, 'must not be empty');
    return [];
  }
  const result: ProviderAccess[] = [];
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const mapping = readMapping(ctx, item, itemPath);
    if (!mapping) return;
    if (!('kind' in mapping)) {
      addError(ctx, join(itemPath, 'kind'), 'is required');
      return;
    }
    const kind = readChoice(ctx, mapping.kind, join(itemPath, 'kind'), ACCESS_KINDS);
    if (kind === 'cli') result.push(checkCli(ctx, mapping, itemPath, rules));
    else if (kind === 'api') result.push(checkApi(ctx, mapping, itemPath, rules));
  });
  return result;
}
