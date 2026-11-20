import {
  ACCESS_EFFECTS,
  defaultAccessPolicy,
  type AccessEffect,
  type AccessPolicy,
  type AccessRule,
  type ResourceCondition,
} from '../../types/access/index.ts';
import type { FieldError } from '../../types/errors.ts';
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

/** What the validation knows of the actions: the catalog and a way to name close ones. */
export interface ActionCatalog {
  names: readonly string[];
  similar: (name: string) => string[];
}

const RULE_KEYS = ['id', 'effect', 'actions', 'subject', 'resource'];
const RESOURCE_KEYS = ['repository', 'pipeline', 'tags', 'author'];

function checkActions(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  catalog: ActionCatalog,
): string[] {
  const items = readStrings(ctx, value, path);
  if (items.length === 0 && Array.isArray(value) && value.length === 0) {
    addError(ctx, path, 'must list at least one action');
  }
  const known = items.filter((item, index) => {
    const covers = item.includes('*')
      ? catalog.names.some((name) => globMatches(item, name))
      : catalog.names.includes(item);
    if (!covers) {
      addError(
        ctx,
        `${path}[${index}]`,
        `unknown action \`${item}\`; did you mean ${catalog
          .similar(item)
          .map((name) => `\`${name}\``)
          .join(', ')}?`,
      );
    }
    return covers;
  });
  return known;
}

function globMatches(pattern: string, name: string): boolean {
  const source = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${source}$`).test(name);
}

function checkSubject(
  ctx: ValidateContext,
  value: unknown,
  path: string,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return out;
  for (const [key, field] of readEntries(ctx, mapping, path, null)) {
    const values = readStrings(ctx, field, join(path, key));
    if (Array.isArray(field) && field.length === 0) {
      addError(ctx, join(path, key), 'must list at least one value');
    }
    out[key] = values;
  }
  return out;
}

function checkResource(ctx: ValidateContext, value: unknown, path: string): ResourceCondition {
  const out: ResourceCondition = {};
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return out;
  for (const [key, field] of readEntries(ctx, mapping, path, RESOURCE_KEYS)) {
    const at = join(path, key);
    if (key === 'author') {
      if (field === 'self') out.author = 'self';
      else addError(ctx, at, 'must be `self`');
    } else {
      const items = readStrings(ctx, field, at);
      if (key === 'repository') out.repository = items;
      if (key === 'pipeline') out.pipeline = items;
      if (key === 'tags') out.tags = items;
    }
  }
  return out;
}

function checkEffect(ctx: ValidateContext, value: unknown, path: string): AccessEffect | null {
  const text = readString(ctx, value, path);
  if (text === null) return null;
  if (!(ACCESS_EFFECTS as readonly string[]).includes(text)) {
    addError(ctx, path, `must be one of ${ACCESS_EFFECTS.join(', ')}`);
    return null;
  }
  return text as AccessEffect;
}

function checkRule(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  catalog: ActionCatalog,
): AccessRule | null {
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return null;
  const before = ctx.errors.length;
  const rule: AccessRule = { id: '', effect: 'allow', actions: [], subject: {}, resource: {} };
  for (const [key, field] of readEntries(ctx, mapping, path, RULE_KEYS)) {
    const at = join(path, key);
    if (key === 'id') rule.id = readString(ctx, field, at) ?? '';
    if (key === 'effect') rule.effect = checkEffect(ctx, field, at) ?? rule.effect;
    if (key === 'actions') rule.actions = checkActions(ctx, field, at, catalog);
    if (key === 'subject') rule.subject = checkSubject(ctx, field, at);
    if (key === 'resource') rule.resource = checkResource(ctx, field, at);
  }
  for (const required of ['id', 'effect', 'actions']) {
    if (!(required in mapping)) addError(ctx, join(path, required), 'is required');
  }
  return ctx.errors.length === before ? rule : null;
}

/** Checks the content of `access.yaml`; the paths of the errors are relative to the file. */
export function validateAccessPolicy(
  value: unknown,
  catalog: ActionCatalog,
): { policy: AccessPolicy; errors: FieldError[] } {
  const ctx: ValidateContext = { errors: [] };
  const policy = defaultAccessPolicy();
  if (value === undefined) return { policy, errors: [] };
  const mapping = readMapping(ctx, value, '');
  if (!mapping) return { policy, errors: ctx.errors };
  for (const [key, field] of readEntries(ctx, mapping, '', ['presets', 'rules'])) {
    if (key === 'presets') policy.presets = readBoolean(ctx, field, key) ?? policy.presets;
    if (key !== 'rules') continue;
    if (!Array.isArray(field)) {
      addError(ctx, 'rules', 'must be a list of rules');
      continue;
    }
    for (const [index, item] of field.entries()) {
      const rule = checkRule(ctx, item, `rules[${index}]`, catalog);
      if (rule !== null) policy.rules.push(rule);
    }
  }
  const seen = new Set<string>();
  for (const [index, rule] of policy.rules.entries()) {
    if (seen.has(rule.id)) addError(ctx, `rules[${index}].id`, `duplicate rule id \`${rule.id}\``);
    seen.add(rule.id);
  }
  return { policy, errors: ctx.errors };
}
