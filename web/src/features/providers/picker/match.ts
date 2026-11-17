import type { ProviderView } from '../../../shared/api/types.ts';

/** The providers whose name or slug contains the query (any case); disabled ones come last. */
export function matchProviders<T extends Pick<ProviderView, 'slug' | 'name' | 'enabled'>>(
  providers: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  const found = providers.filter(
    (provider) =>
      needle === '' ||
      provider.name.toLowerCase().includes(needle) ||
      provider.slug.toLowerCase().includes(needle),
  );
  return [...found.filter((p) => p.enabled), ...found.filter((p) => !p.enabled)];
}
