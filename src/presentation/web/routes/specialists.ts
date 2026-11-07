import { isAbsolute } from 'node:path';
import { z } from 'zod';
import {
  type SpecialistTagsResult,
  type SpecialistsImportResult,
} from '../../ipc/contract/index.ts';
import { tagReply, entryId, parseBody } from '../http.ts';
import { segment, type Route, type RouteKit } from './types.ts';

const levelRepository = z
  .string()
  .nullable()
  .refine((value) => value === null || isAbsolute(value), {
    message: 'repository must be an absolute path',
  });

const tagsSetBody = z.object({
  repository: levelRepository,
  tags: z.array(z.string()),
  revision: z.string().min(1).nullable(),
});

const tagRenameBody = z.object({
  repository: levelRepository,
  from: z.string().min(1),
  to: z.string().min(1),
});

const specialistTagRemoveBody = z.object({ repository: levelRepository, tag: z.string().min(1) });

const importBody = z.object({
  source: z.string().refine((value) => isAbsolute(value), {
    message: 'source must be an absolute path',
  }),
  slugs: z.array(z.string().min(1)).min(1),
});

export function specialistsRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/shared-pipelines$/,
      handle: () => call('shared_pipelines', {}),
    },
    {
      method: 'GET',
      pattern: /^\/api\/shared-specialists$/,
      handle: () => call('shared_specialists', {}),
    },
    {
      method: 'GET',
      pattern: /^\/api\/specialist-tags$/,
      handle: () => call('specialist_tags', {}),
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^/api/specialist-tags/specialists/${segment}$`),
      handle: async ([slug], body) =>
        tagReply(
          (await call('specialist_tags_set', {
            ...parseBody(tagsSetBody, body),
            slug: entryId(slug),
          })) as SpecialistTagsResult,
        ),
    },
    {
      method: 'POST',
      pattern: /^\/api\/specialist-tags\/rename$/,
      handle: async (_match, body) =>
        tagReply(
          (await call(
            'specialist_tag_rename',
            parseBody(tagRenameBody, body),
          )) as SpecialistTagsResult,
        ),
    },
    {
      method: 'POST',
      pattern: /^\/api\/specialist-tags\/remove$/,
      handle: async (_match, body) =>
        tagReply(
          (await call(
            'specialist_tag_remove',
            parseBody(specialistTagRemoveBody, body),
          )) as SpecialistTagsResult,
        ),
    },
    {
      method: 'POST',
      pattern: /^\/api\/config\/specialists\/import$/,
      handle: async (_match, body, repository) =>
        tagReply(
          (await call('specialists_import', {
            repository,
            ...parseBody(importBody, body),
          })) as SpecialistsImportResult,
        ),
    },
  ];
}
