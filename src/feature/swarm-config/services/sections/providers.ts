import { checkAccess } from './provider-access.ts';
import { checkModels, type ModelsRules } from './provider-models.ts';
import {
  type ValidateContext,
  addError,
  join,
  readBoolean,
  readEntries,
  readMapping,
  readString,
} from '../validate-context.ts';
import { isValidSlug, SLUG_PATTERN_TEXT } from '../../types/lookups.ts';
import { isMapping } from '../../types/merge.ts';
import {
  type Provider,
  type ProviderAccess,
  type Role,
  type RoleModels,
} from '../../types/providers/provider.ts';
import { modelIdProblem } from '../../types/specialist.ts';

const PROVIDER_KEYS = ['name', 'enabled', 'access', 'models'];

/** Whether some access of the raw list runs through OpenCode: only then models take options. */
function hasOpencode(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some((item) => isMapping(item) && item.kind === 'cli' && item.runtime === 'opencode')
  );
}

/** The full ID of an OpenCode route must read `provider/model`: the prefix and the model together. */
function checkFullIds(
  ctx: ValidateContext,
  provider: Provider,
  path: string,
  accesses: ProviderAccess[],
): void {
  const reported = new Set<string>();
  accesses.forEach((access, index) => {
    if (access.kind !== 'cli' || access.runtime !== 'opencode') return;
    const roles = new Set([...Object.keys(provider.models), ...Object.keys(access.models)]);
    for (const role of roles) {
      const own = access.models[role];
      const record = own ?? provider.models[role];
      if (record === undefined) continue;
      const full = access.modelPrefix ? `${access.modelPrefix}/${record.model}` : record.model;
      const problem = modelIdProblem('opencode', full);
      if (problem === null) continue;
      const where = own ? `${path}.access[${index}].models.${role}` : `${path}.models.${role}`;
      if (reported.has(where)) continue;
      reported.add(where);
      addError(ctx, where, problem);
    }
  });
}

function checkProvider(
  ctx: ValidateContext,
  slug: string,
  value: unknown,
  path: string,
  roles: readonly string[],
): Provider | null {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  const provider: Provider = {
    slug,
    name: '',
    enabled: true,
    access: [],
    models: {} as RoleModels,
    level: 'project',
  };
  const rules: ModelsRules = { roles, options: hasOpencode(mapping.access) };
  for (const [key, field] of readEntries(ctx, mapping, path, PROVIDER_KEYS)) {
    const fieldPath = join(path, key);
    if (key === 'name') provider.name = readString(ctx, field, fieldPath) ?? '';
    else if (key === 'enabled') provider.enabled = readBoolean(ctx, field, fieldPath) ?? true;
    else if (key === 'access') provider.access = checkAccess(ctx, field, fieldPath, rules);
    else if (key === 'models') provider.models = checkModels(ctx, field, fieldPath, rules);
  }
  if (!('name' in mapping)) addError(ctx, join(path, 'name'), 'is required');
  if (!('access' in mapping)) addError(ctx, join(path, 'access'), 'is required');
  checkFullIds(ctx, provider, path, provider.access);
  return provider;
}

/** The files of `providers/`: slug → provider; the slug is the name of the file. */
export function checkProviders(
  ctx: ValidateContext,
  value: unknown,
  roles: readonly Role[],
): Provider[] {
  const mapping = readMapping(ctx, value, 'swarm.providers');
  if (!mapping) return [];
  const slugs = roles.map((role) => role.slug);
  return readEntries(ctx, mapping, 'swarm.providers', null).flatMap(([slug, field]) => {
    const path = join('swarm.providers', slug);
    if (!isValidSlug(slug)) addError(ctx, path, `slug must match ${SLUG_PATTERN_TEXT}`);
    const provider = checkProvider(ctx, slug, field, path, slugs);
    return provider ? [provider] : [];
  });
}

/** `command` and `args` of the accesses of project providers: the shared level only. */
export function projectCommandProblems(providers: unknown): { path: string; message: string }[] {
  if (!isMapping(providers)) return [];
  const problems: { path: string; message: string }[] = [];
  for (const [slug, provider] of Object.entries(providers)) {
    const access = isMapping(provider) ? provider.access : undefined;
    if (!Array.isArray(access)) continue;
    access.forEach((item, index) => {
      for (const key of ['command', 'args']) {
        if (!isMapping(item) || !(key in item)) continue;
        problems.push({
          path: `swarm.providers.${slug}.access[${index}].${key}`,
          message: `${key} is set only in the global aip/ directory`,
        });
      }
    });
  }
  return problems;
}
