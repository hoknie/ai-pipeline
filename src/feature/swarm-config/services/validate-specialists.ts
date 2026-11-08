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
  REASONING_EFFORTS,
  type Specialist,
} from '../types/specialist.ts';

export const SPECIALIST_KEYS = [
  'name',
  'model',
  'variant',
  'reasoning_effort',
  'runtime',
  'runtime_chain',
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

const CHAIN_CONFLICTS = ['runtime', 'model', 'variant', 'reasoning_effort'] as const;

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
    checkSpecialistField(ctx, specialist, key, field, join(path, key));
  }
  if (!('name' in mapping)) addError(ctx, join(path, 'name'), 'is required');
  checkSpecialistConfig(ctx, mapping, path, specialist);
  return specialist;
}

function checkSpecialistConfig(
  ctx: ValidateContext,
  mapping: Record<string, unknown>,
  path: string,
  specialist: Specialist,
): void {
  if ('runtime_chain' in mapping) {
    for (const conflict of CHAIN_CONFLICTS) {
      if (conflict in mapping) {
        addError(ctx, join(path, conflict), 'cannot be combined with runtime_chain');
      }
    }
    return;
  }
  checkOpencodeOptions(ctx, mapping, path, specialist);
  if (specialist.mcp && specialist.runtime !== 'claude') {
    addError(ctx, join(path, 'mcp'), 'is supported by the claude runtime only');
  }
}

function checkSpecialistField(
  ctx: ValidateContext,
  specialist: Specialist,
  key: string,
  field: unknown,
  fieldPath: string,
): void {
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
    case 'runtime_chain':
      specialist.runtimeChain = readString(ctx, field, fieldPath);
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
      checkTagNames(ctx, field, fieldPath);
      break;
  }
}

function checkOpencodeOptions(
  ctx: ValidateContext,
  mapping: Record<string, unknown>,
  path: string,
  specialist: Specialist,
): void {
  for (const key of ['variant', 'reasoning_effort'] as const) {
    if (!(key in mapping)) continue;
    const fieldPath = join(path, key);
    if (specialist.runtime !== 'opencode') {
      addError(ctx, fieldPath, 'is supported by the opencode runtime only');
    }
    if (key === 'variant') {
      const variant = readString(ctx, mapping[key], fieldPath);
      if (variant !== null) specialist.variant = variant.trim();
    } else {
      const effort = readChoice(ctx, mapping[key], fieldPath, REASONING_EFFORTS);
      if (effort !== null) specialist.reasoningEffort = effort;
    }
  }
}
