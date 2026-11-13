import type { HandlerTable } from './types.ts';

/** The configuration editor: pipelines, specialists, settings, tags of specialists, imports. */
export const configHandlers = {
  pipelines: (params, { services }) => services.edits.pipelines(params.repository),
  system_stages: (params, { services }) => services.edits.systemStages(params.repository),
  config: (params, { services }) => services.edits.view(params.repository),
  config_models: (params, { services }) =>
    services.edits.models(params.repository, params.refresh ?? false),
  config_catalog: (params, { services }) => services.edits.catalog(params.repository),
  config_write: (params, { services }) =>
    services.edits.edit(params.repository, {
      kind: params.kind,
      id: params.id,
      value: params.value,
      revision: params.revision,
      level: params.level ?? 'project',
    }),
  config_delete: (params, { services }) =>
    services.edits.edit(params.repository, {
      kind: params.kind,
      id: params.id,
      value: null,
      revision: params.revision,
      level: params.level ?? 'project',
    }),
  config_setting: (params, { services }) =>
    services.edits.settings({
      repository: params.repository,
      values: { [params.path]: params.value },
      revision: params.revision,
      level: params.level,
    }),
  config_settings: (params, { services }) => services.edits.settings(params),
  config_mcp_server: (params, { services }) =>
    services.edits.mcpServer(params.repository, {
      name: params.name,
      value: params.value,
      revision: params.revision,
      level: params.level,
    }),
  config_preview: (params, { services }) => services.edits.preview(params),
  specialist_tags: async (_params, { services }) => services.shared.specialistTags(),
  shared_specialists: async (_params, { services }) => services.shared.specialists(),
  shared_pipelines: async (_params, { services }) => services.shared.pipelines(),
  specialist_tags_set: async (params, { services }) =>
    services.shared.setTags(params.repository, params.slug, params.tags, params.revision),
  specialist_tag_rename: async (params, { services }) =>
    services.shared.renameTag(params.repository, params.from, params.to),
  specialist_tag_remove: async (params, { services }) =>
    services.shared.removeTag(params.repository, params.tag),
  pipelines_import: async (params, { services }) => services.shared.importPipelines(params),
  specialists_import: async (params, { services }) => services.shared.importSpecialists(params),
} satisfies Partial<HandlerTable>;
