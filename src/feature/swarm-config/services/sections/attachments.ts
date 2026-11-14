import { type FieldError } from '../../types/errors.ts';
import {
  ATTACHMENT_STORAGES,
  type AttachmentSettings,
  type AttachmentStorage,
  defaultAttachments,
} from '../../types/settings.ts';
import {
  type ValidateContext,
  addError,
  readBoolean,
  readChoice,
  readEntries,
  readMapping,
  readString,
} from '../validate-context.ts';

const S3_KEYS = ['bucket', 'region', 'endpoint', 'prefix', 'path_style'];

function checkAttachments(
  ctx: ValidateContext,
  value: unknown,
  attachments: AttachmentSettings,
): void {
  const mapping = readMapping(ctx, value, 'swarm.attachments');
  if (!mapping) return;
  readEntries(ctx, mapping, 'swarm.attachments', ['storage', 's3']);
  if ('storage' in mapping) {
    attachments.storage =
      readChoice<AttachmentStorage>(
        ctx,
        mapping.storage,
        'swarm.attachments.storage',
        ATTACHMENT_STORAGES,
      ) ?? attachments.storage;
  }
  if ('s3' in mapping) {
    const s3 = readMapping(ctx, mapping.s3, 'swarm.attachments.s3');
    if (s3) {
      for (const [key, field] of readEntries(ctx, s3, 'swarm.attachments.s3', S3_KEYS)) {
        const path = `swarm.attachments.s3.${key}`;
        if (key === 'bucket') attachments.s3.bucket = readString(ctx, field, path);
        if (key === 'region')
          attachments.s3.region = readString(ctx, field, path) ?? attachments.s3.region;
        if (key === 'endpoint') {
          const endpoint = readString(ctx, field, path);
          if (endpoint !== null) {
            try {
              const url = new URL(endpoint);
              if (!['http:', 'https:'].includes(url.protocol) || !url.hostname)
                throw new Error('invalid URL');
              attachments.s3.endpoint = endpoint;
            } catch {
              addError(ctx, path, 'must be an http:// or https:// URL');
            }
          }
        }
        if (key === 'prefix') {
          const prefix = readString(ctx, field, path);
          if (prefix !== null) {
            if (prefix.startsWith('/')) addError(ctx, path, 'must not start with /');
            else attachments.s3.prefix = prefix;
          }
        }
        if (key === 'path_style') {
          attachments.s3.pathStyle = readBoolean(ctx, field, path) ?? attachments.s3.pathStyle;
        }
      }
    }
  }
  if (attachments.storage === 's3' && attachments.s3.bucket === null) {
    addError(ctx, 'swarm.attachments.s3.bucket', 'is required when storage is s3');
  }
}

/** Validate the global attachments section in isolation from other settings. */
export function validateAttachmentsSection(value: unknown): {
  attachments: AttachmentSettings;
  errors: FieldError[];
} {
  const ctx: ValidateContext = { errors: [] };
  const attachments = defaultAttachments();
  if (value !== undefined) checkAttachments(ctx, value, attachments);
  return { attachments, errors: ctx.errors };
}
