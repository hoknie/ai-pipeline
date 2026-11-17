import type { ConfigEditResult, ProviderModelsView, ProvidersView, WriteLevel } from '../types.ts';
import { call, edit, enc, json, levelQuery } from '../http.ts';

/** The providers of the registry: the list, their models, writing and deleting. */
export interface ProviderApi {
  /** The roles, the providers with status and limit, and the role × provider matrix. */
  providers(): Promise<ProvidersView>;
  /** The models of a provider by access; `refresh` asks the catalogs again. */
  providerModels(slug: string, refresh?: boolean): Promise<ProviderModelsView>;
  /** Writes a provider file; problems with the edit come back as a result, not an error. */
  writeProvider(
    slug: string,
    value: Record<string, unknown>,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  /** Refused with the chains that name the provider when one still uses it. */
  deleteProvider(slug: string, revision: string, level?: WriteLevel): Promise<ConfigEditResult>;
}

export function providerApi(at: (path: string) => string): ProviderApi {
  return {
    providers: () => call(at('/api/config/providers')),
    providerModels: (slug, refresh) =>
      call(at(`/api/config/providers/${enc(slug)}/models${refresh ? '?refresh=1' : ''}`)),
    writeProvider: (slug, value, revision, level) =>
      edit(
        at(`/api/config/providers/${enc(slug)}`),
        json('PUT', { value, revision, ...(level ? { level } : {}) }),
      ),
    deleteProvider: (slug, revision, level) =>
      edit(at(`/api/config/providers/${enc(slug)}?revision=${enc(revision)}${levelQuery(level)}`), {
        method: 'DELETE',
      }),
  };
}
