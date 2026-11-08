import { SLUG_PATTERN_TEXT, isValidSlug } from '../../../feature/swarm-config/types/index.ts';
import { settingFieldOf } from '../../../feature/swarm-edit/types/index.ts';
import { z } from 'zod';

/** A value of a field of settings.yaml; null removes the field. */
export const settingValueSchema = z
  .union([z.boolean(), z.number(), z.string(), z.array(z.string())])
  .nullable();

/** A path of the catalog of writable fields, also `runtimes.<runtime>.env.<NAME>`. */
const settingPathSchema = z
  .string()
  .min(1)
  .refine((path) => settingFieldOf(path) !== undefined, { message: 'unknown setting' });

export const entryIdSchema = z
  .string()
  .refine(isValidSlug, { message: `id must match ${SLUG_PATTERN_TEXT}` });

const entryKindSchema = z.enum(['specialist', 'pipeline', 'action', 'chain']);

/** Repository of the project level; null is the shared level. */
const levelRepository = z.string().min(1).nullable();

const writeLevelSchema = z.enum(['project', 'global']);

export const configRequests = [
  z.object({
    method: z.literal('pipelines'),
    params: z.object({ repository: z.string().min(1) }),
  }),
  z.object({
    method: z.literal('system_stages'),
    params: z.object({ repository: z.string().min(1) }),
  }),
  z.object({
    method: z.literal('config'),
    params: z.object({ repository: z.string().min(1) }),
  }),
  z.object({
    method: z.literal('config_catalog'),
    params: z.object({ repository: z.string().min(1) }),
  }),
  z.object({
    method: z.literal('config_write'),
    params: z.object({
      repository: z.string().min(1),
      kind: entryKindSchema,
      id: entryIdSchema,
      value: z.record(z.string(), z.unknown()),
      revision: z.string().min(1).nullable(),
      level: writeLevelSchema.optional(),
    }),
  }),
  z.object({
    method: z.literal('config_setting'),
    params: z.object({
      repository: z.string().min(1),
      path: settingPathSchema,
      value: settingValueSchema,
      revision: z.string().min(1).nullable(),
      level: writeLevelSchema.default('global'),
    }),
  }),
  z.object({
    method: z.literal('config_settings'),
    params: z.object({
      repository: z.string().min(1),
      values: z
        .record(settingPathSchema, settingValueSchema)
        .refine((values) => Object.keys(values).length > 0, {
          message: 'values must not be empty',
        }),
      revision: z.string().min(1).nullable(),
      level: writeLevelSchema.default('global'),
    }),
  }),
  z.object({
    method: z.literal('config_preview'),
    params: z.object({
      repository: z.string().min(1),
      kind: z.literal('pipeline'),
      id: entryIdSchema,
      value: z.record(z.string(), z.unknown()),
      level: writeLevelSchema.optional(),
    }),
  }),
  z.object({
    method: z.literal('specialist_tags'),
    params: z.object({}),
  }),
  z.object({
    method: z.literal('shared_specialists'),
    params: z.object({}),
  }),
  z.object({
    method: z.literal('specialist_tags_set'),
    params: z.object({
      repository: levelRepository,
      slug: entryIdSchema,
      tags: z.array(z.string()),
      revision: z.string().min(1).nullable(),
    }),
  }),
  z.object({
    method: z.literal('specialist_tag_rename'),
    params: z.object({
      repository: levelRepository,
      from: z.string().min(1),
      to: z.string().min(1),
    }),
  }),
  z.object({
    method: z.literal('specialist_tag_remove'),
    params: z.object({ repository: levelRepository, tag: z.string().min(1) }),
  }),
  z.object({
    method: z.literal('specialists_import'),
    params: z.object({
      repository: z.string().min(1),
      source: z.string().min(1),
      slugs: z.array(entryIdSchema).min(1),
    }),
  }),
  z.object({
    method: z.literal('shared_pipelines'),
    params: z.object({}),
  }),
  z.object({
    method: z.literal('pipelines_import'),
    params: z.object({
      repository: z.string().min(1),
      source: z.string().min(1),
      ids: z.array(entryIdSchema).min(1),
    }),
  }),
  z.object({
    method: z.literal('config_delete'),
    params: z.object({
      repository: z.string().min(1),
      kind: entryKindSchema,
      id: entryIdSchema,
      revision: z.string().min(1),
      level: writeLevelSchema.optional(),
    }),
  }),
] as const;
