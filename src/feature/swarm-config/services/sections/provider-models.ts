import {
  type ValidateContext,
  addError,
  join,
  readChoice,
  readEntries,
  readMapping,
  readString,
} from '../validate-context.ts';
import { isMapping } from '../../types/merge.ts';
import { type RoleModel, type RoleModels } from '../../types/providers/provider.ts';
import { REASONING_EFFORTS } from '../../types/specialist.ts';

const MODEL_KEYS = ['model', 'variant', 'reasoning_effort'];

/** What `models` may contain: the roles of the configuration, and the options only OpenCode takes. */
export interface ModelsRules {
  roles: readonly string[];
  options: boolean;
}

function checkRoleModel(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  rules: ModelsRules,
): RoleModel | null {
  if (typeof value === 'string') {
    const model = readString(ctx, value, path);
    return model === null ? null : { model };
  }
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  const result: RoleModel = { model: '' };
  for (const [key, field] of readEntries(ctx, mapping, path, MODEL_KEYS)) {
    const fieldPath = join(path, key);
    if (key === 'model') result.model = readString(ctx, field, fieldPath) ?? '';
    else if (!rules.options) {
      addError(ctx, fieldPath, 'is supported only by a provider with an opencode access');
    } else if (key === 'variant') {
      const variant = readString(ctx, field, fieldPath);
      if (variant !== null) result.variant = variant.trim();
    } else {
      const effort = readChoice(ctx, field, fieldPath, REASONING_EFFORTS);
      if (effort !== null) result.reasoningEffort = effort;
    }
  }
  if (!('model' in mapping)) addError(ctx, join(path, 'model'), 'is required');
  return result.model === '' ? null : result;
}

/** The `models` of a provider or of one access: role slug → model. */
export function checkModels(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  rules: ModelsRules,
): RoleModels {
  const result: RoleModels = {};
  if (!isMapping(value)) {
    addError(ctx, path, 'must be a mapping');
    return result;
  }
  for (const [role, field] of Object.entries(value)) {
    const rolePath = join(path, role);
    if (!rules.roles.includes(role)) {
      addError(
        ctx,
        rolePath,
        `unknown role \`${role}\`; known: ${rules.roles.join(', ') || 'none'}`,
      );
      continue;
    }
    const model = checkRoleModel(ctx, field, rolePath, rules);
    if (model !== null) result[role] = model;
  }
  return result;
}
