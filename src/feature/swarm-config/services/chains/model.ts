import { type ChainRuntimeItem } from '../../types/chain.ts';
import { isValidSlug, SLUG_PATTERN_TEXT } from '../../types/lookups.ts';
import { type ProviderRegistry, type Role, roleModelOf } from '../../types/providers/provider.ts';
import { addError, join, readString, type ValidateContext } from '../validate-context.ts';

/** Resolve the source reference once; execution and snapshots only receive concrete values. */
export function resolveChainRole(
  ctx: ValidateContext,
  mapping: Record<string, unknown>,
  path: string,
  item: ChainRuntimeItem,
  registry: ProviderRegistry & { roles: readonly Role[] },
): void {
  if (!('model_role' in mapping)) return;
  const rolePath = join(path, 'model_role');
  if ('model' in mapping) addError(ctx, join(path, 'model'), 'cannot be combined with model_role');
  const role = readString(ctx, mapping.model_role, rolePath);
  if (!('provider' in mapping)) addError(ctx, join(path, 'provider'), 'is required for model_role');
  if (role === null) return;
  if (!isValidSlug(role)) {
    addError(ctx, rolePath, `slug must match ${SLUG_PATTERN_TEXT}`);
    return;
  }
  if (!registry.roles.some((entry) => entry.slug === role)) {
    addError(ctx, rolePath, `unknown role \`${role}\``);
    return;
  }
  const provider = registry.providers.find((entry) => entry.slug === item.provider);
  if (!provider) return; // The provider field has its own diagnostic.
  const access = provider.access.find(
    (entry) => entry.kind === 'cli' && entry.enabled && entry.runtime === item.runtime,
  );
  if (!access) {
    addError(
      ctx,
      join(path, 'runtime'),
      `no enabled CLI route for ${item.runtime} at provider \`${provider.slug}\``,
    );
    return;
  }
  const record = roleModelOf(provider, access, role);
  if (!record) {
    addError(ctx, rolePath, `no model for role \`${role}\` at provider \`${provider.slug}\``);
    return;
  }
  item.model = record.model;
  if (item.runtime === 'opencode') {
    if (record.variant !== undefined) item.variant = record.variant;
    if (record.reasoningEffort !== undefined) item.reasoningEffort = record.reasoningEffort;
  }
}
