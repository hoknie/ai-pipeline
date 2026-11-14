import {
  ARTIFACT_CONTENT_LIMIT,
  ARTIFACT_FILE_NAME_LIMIT,
  ARTIFACT_TITLE_LIMIT,
  validArtifactFileName,
} from '../../../feature/artifacts/types/index.ts';
import { target } from './runs.ts';
import { z } from 'zod';

/** A file a specialist publishes outside of git: exactly one of `content` and `path`. */
export const artifactPublishParams = z
  .object({
    token: z.string().min(1),
    fileName: z
      .string()
      .max(ARTIFACT_FILE_NAME_LIMIT)
      .refine(validArtifactFileName, { message: 'not a plain file name' }),
    title: z.string().trim().min(1).max(ARTIFACT_TITLE_LIMIT).optional(),
    content: z.string().max(ARTIFACT_CONTENT_LIMIT).optional(),
    path: z.string().min(1).optional(),
  })
  .refine((params) => (params.content === undefined) !== (params.path === undefined), {
    message: 'pass either content or path',
  });

export const artifactsRequests = [
  z.object({ method: z.literal('group_artifacts'), params: z.object(target) }),
  z.object({
    method: z.literal('artifact'),
    params: z.object({ ...target, id: z.string().min(1) }),
  }),
  z.object({ method: z.literal('artifact_publish'), params: artifactPublishParams }),
  z.object({
    method: z.literal('attachment'),
    params: z.object({ runId: z.string().min(1), id: z.string().min(1) }),
  }),
] as const;
