import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, ProviderView } from '../../../shared/api/types.ts';
import { editFailure } from '../matrix/useCellWrite.ts';
import { writableSourceOf, type ProvidersScope, type Raw } from '../page/sources.ts';

const isRaw = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function withoutKey(models: unknown, role: string): Raw | undefined {
  if (!isRaw(models)) return undefined;
  const { [role]: _removed, ...rest } = models;
  return Object.keys(rest).length === 0 ? undefined : rest;
}

/** The provider file without the role in its models and in the models of its accesses. */
export function withoutRole(raw: Raw, role: string): Raw {
  const { models: _models, access, ...rest } = raw;
  const models = withoutKey(raw.models, role);
  const cleaned = Array.isArray(access)
    ? access.map((item) => {
        if (!isRaw(item)) return item;
        const { models: _own, ...others } = item;
        const own = withoutKey(item.models, role);
        return own ? { ...others, models: own } : others;
      })
    : access;
  return {
    ...rest,
    ...(cleaned === undefined ? {} : { access: cleaned }),
    ...(models ? { models } : {}),
  };
}

/** The providers that have a model of the role, in the provider or in one of its accesses. */
export function holdersOf(providers: readonly ProviderView[], role: string): ProviderView[] {
  return providers.filter(
    (provider) =>
      role in provider.models || provider.access.some((access) => role in access.models),
  );
}

export interface Removal {
  /** The providers written without the role, in order. */
  cleared: string[];
  /** Why the sequence stopped; null when every write was accepted. */
  error: string | null;
}

/**
 * Writes each provider without the role, one after another, and stops at the first refusal:
 * every step leaves a valid configuration, so a partial result is safe and a repeat goes on.
 */
export async function clearHolders(
  api: Api,
  editor: ConfigEditorResponse,
  holders: readonly ProviderView[],
  role: string,
  scope: ProvidersScope = 'project',
): Promise<Removal> {
  const cleared: string[] = [];
  for (const holder of holders) {
    const source = writableSourceOf(
      editor.providers.find((item) => item.slug === holder.slug),
      scope,
    );
    if (!source) return { cleared, error: `${holder.slug}: no file` };
    try {
      const result = await api.writeProvider(
        holder.slug,
        withoutRole(source.raw, role),
        source.revision,
        source.level,
      );
      if (!result.ok) return { cleared, error: `${holder.slug}: ${editFailure(result)}` };
    } catch (failure) {
      return { cleared, error: `${holder.slug}: ${(failure as Error).message}` };
    }
    cleared.push(holder.slug);
  }
  return { cleared, error: null };
}
