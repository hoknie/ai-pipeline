import {
  type ValidateContext,
  addError,
  join,
  readEntries,
  readMapping,
  readString,
} from '../validate-context.ts';
import { isValidSlug, SLUG_PATTERN_TEXT } from '../../types/lookups.ts';
import { type Role } from '../../types/providers/provider.ts';

const ROLE_KEYS = ['name'];

/** The `roles` section of settings.yaml: slug → `{ name }`, in the order of the file. */
export function checkRoles(ctx: ValidateContext, value: unknown): Role[] {
  const mapping = readMapping(ctx, value, 'swarm.roles');
  if (!mapping) return [];
  return readEntries(ctx, mapping, 'swarm.roles', null).flatMap(([slug, field]) => {
    const path = join('swarm.roles', slug);
    if (!isValidSlug(slug)) addError(ctx, path, `slug must match ${SLUG_PATTERN_TEXT}`);
    const role = readMapping(ctx, field, path);
    if (!role) return [];
    let name = '';
    for (const [key, item] of readEntries(ctx, role, path, ROLE_KEYS)) {
      if (key === 'name') name = readString(ctx, item, join(path, key)) ?? '';
    }
    if (!('name' in role)) addError(ctx, join(path, 'name'), 'is required');
    return [{ slug, name, level: 'project' as const }];
  });
}
