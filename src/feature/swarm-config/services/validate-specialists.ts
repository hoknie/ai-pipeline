import {
  type ValidateContext,
  addError,
  checkTagNames,
  join,
  readBoolean,
  readChoice,
  readEntries,
  readInteger,
  readMapping,
  readString,
  readStrings,
  readTimeout,
} from './validate-context.ts';
import { checkMcpServers } from './validate-runtimes.ts';
import { isValidSlug, SLUG_PATTERN_TEXT } from '../types/lookups.ts';
import { MAX_RANGE } from '../types/settings.ts';
import {
  type Defaults,
  type Permissions,
  PERMISSIONS,
  type Runtime,
  RUNTIMES,
  type Specialist,
} from '../types/specialist.ts';

export const SPECIALIST_KEYS = [
  'name',
  'model',
  'runtime',
  'permissions',
  'timeout',
  'allow_commands',
  'tools',
  'mcp',
  'skills',
  'prompt',
  'max',
  'queue',
  'tags',
];

export function checkSpecialists(
  ctx: ValidateContext,
  value: unknown,
  defaults: Defaults,
): Specialist[] {
  const mapping = readMapping(ctx, value, 'swarm.specialists');
  if (!mapping) return [];
  return readEntries(ctx, mapping, 'swarm.specialists', null).flatMap(([slug, field]) => {
    const path = join('swarm.specialists', slug);
    if (!isValidSlug(slug)) addError(ctx, path, `slug must match ${SLUG_PATTERN_TEXT}`);
    const specialist = checkSpecialist(ctx, slug, field, path, defaults);
    return specialist ? [specialist] : [];
  });
}

export function checkSpecialist(
  ctx: ValidateContext,
  slug: string,
  value: unknown,
  path: string,
  defaults: Defaults,
  allowed: readonly string[] = SPECIALIST_KEYS,
): Specialist | null {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  const specialist: Specialist = {
    slug,
    name: '',
    model: null,
    runtime: defaults.runtime,
    permissions: defaults.permissions,
    timeoutSeconds: defaults.timeoutSeconds,
    allowCommands: [...defaults.allowCommands],
    tools: [...defaults.tools],
    skills: [],
    prompt: null,
    max: null,
    queue: false,
    level: 'project',
  };
  for (const [key, field] of readEntries(ctx, mapping, path, [...allowed])) {
    const fieldPath = join(path, key);
    switch (key) {
      case 'name':
        specialist.name = readString(ctx, field, fieldPath) ?? '';
        break;
      case 'model':
        specialist.model = readString(ctx, field, fieldPath);
        break;
      case 'runtime':
        specialist.runtime =
          readChoice<Runtime>(ctx, field, fieldPath, RUNTIMES) ?? specialist.runtime;
        break;
      case 'permissions':
        specialist.permissions =
          readChoice<Permissions>(ctx, field, fieldPath, PERMISSIONS) ?? specialist.permissions;
        break;
      case 'timeout':
        specialist.timeoutSeconds = readTimeout(ctx, field, fieldPath) ?? specialist.timeoutSeconds;
        break;
      case 'allow_commands':
        specialist.allowCommands = readStrings(ctx, field, fieldPath);
        break;
      case 'tools':
        specialist.tools = readStrings(ctx, field, fieldPath);
        break;
      case 'mcp':
        specialist.mcp = checkMcpServers(ctx, field, fieldPath);
        break;
      case 'skills':
        specialist.skills = readStrings(ctx, field, fieldPath);
        break;
      case 'prompt':
        specialist.prompt = readString(ctx, field, fieldPath);
        break;
      case 'max':
        specialist.max = readInteger(ctx, field, fieldPath, MAX_RANGE);
        break;
      case 'queue':
        specialist.queue = readBoolean(ctx, field, fieldPath) ?? false;
        break;
      case 'tags':
        // Tags are metadata for the panel: checked here, never part of the specialist.
        checkTagNames(ctx, field, fieldPath);
        break;
    }
  }
  if (!('name' in mapping)) addError(ctx, join(path, 'name'), 'is required');
  if (specialist.mcp && specialist.runtime !== 'claude') {
    addError(ctx, join(path, 'mcp'), 'is supported by the claude runtime only');
  }
  return specialist;
}
