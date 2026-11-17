import { useCallback, useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditResult, EditorProvider } from '../../../shared/api/types.ts';
import { invalidateProviders } from '../page/useProviderRegistry.ts';
import { useProvidersScope } from '../page/scope.ts';
import { sourceOf, type Raw } from '../page/sources.ts';

/** The text of a failed edit: the first error of the file, or the conflict. */
export function editFailure(result: Extract<ConfigEditResult, { ok: false }>): string {
  if (result.reason === 'conflict') return result.message;
  return result.errors.map((error) => `${error.path}: ${error.message}`).join('; ');
}

/**
 * Writes the file of a provider through `change`; the error of a write (a stale revision too) is
 * kept by cell and the registry is read again either way.
 */
export function useCellWrite(
  api: Api,
  repository: string | null,
  providers: readonly EditorProvider[],
) {
  const scope = useProvidersScope();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const write = useCallback(
    async (cell: string, slug: string, change: (raw: Raw) => Raw) => {
      const source = sourceOf(
        providers.find((provider) => provider.slug === slug),
        scope,
      );
      if (!source) return;
      setBusy(cell);
      try {
        const result = await api.writeProvider(
          slug,
          change(source.raw),
          source.revision,
          source.level,
        );
        setErrors((current) => {
          const { [cell]: _gone, ...rest } = current;
          return result.ok ? rest : { ...rest, [cell]: editFailure(result) };
        });
      } catch (failure) {
        setErrors((current) => ({ ...current, [cell]: (failure as Error).message }));
      } finally {
        setBusy(null);
        await invalidateProviders(repository);
      }
    },
    [api, repository, providers, scope],
  );
  return { write, errors, busy };
}
