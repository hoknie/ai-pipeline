import type { Method } from '../../contract/index.ts';
import {
  type AuditRow,
  configInfo,
  defaultGlobal,
  explicitGlobal,
  levelAction,
  pick,
  resource,
  sharedTags,
} from './audit-helpers.ts';

/** The settings, shared and of a project, and the statistics. */
export const settingsActions: Partial<Record<Method, AuditRow>> = {
  stats_clear: { action: 'stats.clear', info: () => ({ repository: null }) },
  observers_set: {
    action: 'config.global.write',
    info: (params) => ({
      repository: null,
      resource: { kind: 'observers', id: 'settings' },
      details: { fields: Object.keys((params.settings as object | undefined) ?? {}) },
    }),
  },
  config_write: {
    action: levelAction(explicitGlobal),
    info: (params) => configInfo(params, explicitGlobal(params)),
  },
  config_delete: {
    action: levelAction(explicitGlobal),
    info: (params) => configInfo(params, explicitGlobal(params)),
  },
  config_setting: {
    action: levelAction(defaultGlobal),
    info: (params) =>
      configInfo({ ...params, kind: 'setting', id: params.path }, defaultGlobal(params)),
  },
  config_settings: {
    action: levelAction(defaultGlobal),
    info: (params) => ({
      ...configInfo({ kind: 'setting' }, defaultGlobal(params)),
      details: {
        level: defaultGlobal(params) ? 'global' : 'project',
        paths: Object.keys((params.values as object | undefined) ?? {}),
      },
    }),
  },
  config_mcp_server: {
    action: levelAction(defaultGlobal),
    info: (params) =>
      configInfo({ ...params, kind: 'mcp_server', id: params.name }, defaultGlobal(params)),
  },
  specialist_tags_set: {
    action: levelAction(sharedTags),
    info: (params) => ({
      ...(sharedTags(params) ? { repository: null } : {}),
      resource: resource('specialist', params.slug),
      details: { tags: params.tags },
    }),
  },
  specialist_tag_rename: {
    action: levelAction(sharedTags),
    info: (params) => ({
      ...(sharedTags(params) ? { repository: null } : {}),
      details: pick(params, 'from', 'to'),
    }),
  },
  specialist_tag_remove: {
    action: levelAction(sharedTags),
    info: (params) => ({
      ...(sharedTags(params) ? { repository: null } : {}),
      details: pick(params, 'tag'),
    }),
  },
  specialists_import: {
    action: 'config.global.write',
    info: (params) => ({
      repository: null,
      details: { source: params.source, slugs: params.slugs },
    }),
  },
  pipelines_import: {
    action: 'config.global.write',
    info: (params) => ({ repository: null, details: { source: params.source, ids: params.ids } }),
  },
};
