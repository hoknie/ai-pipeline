import type { SystemStagesResponse } from '../lib/pipeline/pipelineEntries.ts';
import type {
  ConfigCatalogResponse,
  ConfigEditResult,
  ConfigModelsResponse,
  ConfigEditorResponse,
  ConfigPreview,
  PipelinesImportResult,
  PipelinesView,
  SettingValue,
  SharedPipelinesView,
  SharedSpecialistsView,
  SpecialistTagsView,
  SpecialistsImportResult,
  WriteLevel,
} from './types.ts';
import { call, edit, enc, json, levelQuery, post, withRepository } from './http.ts';

export interface ConfigApi {
  /** Pipelines of the bound repository, or of the one given. */
  pipelines(repository?: string): Promise<PipelinesView>;
  /** The configuration of the bound repository, for the editors. */
  config(): Promise<ConfigEditorResponse>;
  /** Tools and skills a specialist can name, per runtime. */
  catalog(): Promise<ConfigCatalogResponse>;
  /** Models a specialist can name, per runtime; `refresh` asks the runtimes again. */
  models(refresh?: boolean): Promise<ConfigModelsResponse>;
  /** Writes a specialist file; problems with the edit come back as a result, not an error. */
  writeSpecialist(
    id: string,
    value: Record<string, unknown>,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  deleteSpecialist(id: string, revision: string, level?: WriteLevel): Promise<ConfigEditResult>;
  /** The shared specialists with the repositories of the registry that use them. */
  sharedSpecialists(): Promise<SharedSpecialistsView>;
  /** The specialists of the shared level and of every repository, with their tags. */
  specialistTags(): Promise<SpecialistTagsView>;
  /** Copies project specialists of another repository into the bound one. */
  importSpecialists(source: string, slugs: string[]): Promise<SpecialistsImportResult>;
  /** The shared pipelines with the repositories of the registry that use them. */
  sharedPipelines(): Promise<SharedPipelinesView>;
  /** Copies project pipelines of another repository into the bound one. */
  importPipelines(source: string, ids: string[]): Promise<PipelinesImportResult>;
  /** Writes one general setting (`null` removes it); problems come back as a result. */
  writeSetting(
    path: string,
    value: SettingValue,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  /** Writes several settings of one level in one go (`null` removes a field). */
  writeSettings(
    values: Record<string, SettingValue>,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  writePipeline(
    id: string,
    value: Record<string, unknown>,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  deletePipeline(id: string, revision: string, level?: WriteLevel): Promise<ConfigEditResult>;
  /** The graph and the errors of a draft pipeline; nothing is written. */
  previewPipeline(
    id: string,
    value: Record<string, unknown>,
    level?: WriteLevel,
  ): Promise<ConfigPreview>;
  /** Writes an action file; problems with the edit come back as a result, not an error. */
  writeAction(
    id: string,
    value: Record<string, unknown>,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  /** Refused with the places that name the action when a point still uses it. */
  deleteAction(id: string, revision: string, level?: WriteLevel): Promise<ConfigEditResult>;
  writeChain(
    id: string,
    value: Record<string, unknown>,
    revision: string | null,
    level?: WriteLevel,
  ): Promise<ConfigEditResult>;
  deleteChain(id: string, revision: string, level?: WriteLevel): Promise<ConfigEditResult>;
  /** The built-in stages of the pipeline with their tasks and settings. */
  systemStages(): Promise<SystemStagesResponse>;
}

export function configApi(repository: string | null): ConfigApi {
  const at = (path: string) => withRepository(path, repository);
  return {
    pipelines: (other) => call(withRepository('/api/pipelines', other ?? repository)),
    config: () => call(at('/api/config')),
    catalog: () => call(at('/api/config/catalog')),
    models: (refresh) => call(at(`/api/config/models${refresh ? '?refresh=1' : ''}`)),
    writeSpecialist: (id, value, revision, level) =>
      edit(
        at(`/api/config/specialists/${enc(id)}`),
        json('PUT', { value, revision, ...(level ? { level } : {}) }),
      ),
    deleteSpecialist: (id, revision, level) =>
      edit(at(`/api/config/specialists/${enc(id)}?revision=${enc(revision)}${levelQuery(level)}`), {
        method: 'DELETE',
      }),
    sharedSpecialists: () => call('/api/shared-specialists'),
    specialistTags: () => call('/api/specialist-tags'),
    importSpecialists: async (source, slugs) =>
      (await edit(
        at('/api/config/specialists/import'),
        json('POST', { source, slugs }),
      )) as unknown as SpecialistsImportResult,
    sharedPipelines: () => call('/api/shared-pipelines'),
    importPipelines: async (source, ids) =>
      (await edit(
        at('/api/config/pipelines/import'),
        json('POST', { source, ids }),
      )) as unknown as PipelinesImportResult,
    writeSetting: (path, value, revision, level) =>
      edit(
        at(`/api/config/settings/${enc(path)}`),
        json('PUT', { value, revision, ...(level ? { level } : {}) }),
      ),
    writeSettings: (values, revision, level) =>
      edit(
        at('/api/config/settings'),
        json('PUT', { values, revision, ...(level ? { level } : {}) }),
      ),
    writePipeline: (id, value, revision, level) =>
      edit(
        at(`/api/config/pipelines/${enc(id)}`),
        json('PUT', { value, revision, ...(level ? { level } : {}) }),
      ),
    deletePipeline: (id, revision, level) =>
      edit(at(`/api/config/pipelines/${enc(id)}?revision=${enc(revision)}${levelQuery(level)}`), {
        method: 'DELETE',
      }),
    previewPipeline: (id, value, level) =>
      post(at(`/api/config/pipelines/${enc(id)}/preview`), {
        value,
        ...(level ? { level } : {}),
      }),
    writeAction: (id, value, revision, level) =>
      edit(
        at(`/api/config/actions/${enc(id)}`),
        json('PUT', { value, revision, ...(level ? { level } : {}) }),
      ),
    deleteAction: (id, revision, level) =>
      edit(at(`/api/config/actions/${enc(id)}?revision=${enc(revision)}${levelQuery(level)}`), {
        method: 'DELETE',
      }),
    writeChain: (id, value, revision, level) =>
      edit(
        at(`/api/config/chains/${enc(id)}`),
        json('PUT', { value, revision, ...(level ? { level } : {}) }),
      ),
    deleteChain: (id, revision, level) =>
      edit(at(`/api/config/chains/${enc(id)}?revision=${enc(revision)}${levelQuery(level)}`), {
        method: 'DELETE',
      }),
    systemStages: () => call(at('/api/system-stages')),
  };
}
