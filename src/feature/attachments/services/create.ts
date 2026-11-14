import { join } from 'node:path';

import type { Database } from '../../../platform/sqlite/index.ts';
import { S3Client, type S3Credentials } from '../../../platform/s3/client.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import {
  AttachmentRepository,
  FileAttachmentStorage,
  S3AttachmentStorage,
} from '../repositories/index.ts';

import { AttachmentService } from './attachments.ts';

export interface AttachmentsServices {
  attachments: AttachmentService;
}

export function createAttachmentsServices(dependencies: {
  database: Database;
  /** The state directory: attachments are kept in its `attachments` folder. */
  stateDirectory: string;
  now: () => number;
  config?: ConfigService;
  s3Credentials?: S3Credentials | null;
  log?: (message: string) => void;
}): AttachmentsServices {
  return {
    attachments: new AttachmentService({
      attachments: new AttachmentRepository(dependencies.database),
      storages: [new FileAttachmentStorage(join(dependencies.stateDirectory, 'attachments'))],
      now: dependencies.now,
      ...(dependencies.config
        ? { attachmentSettings: () => dependencies.config!.attachmentSettings() }
        : {}),
      s3Credentials: dependencies.s3Credentials ?? null,
      ...(dependencies.s3Credentials
        ? {
            s3Storage: (settings) =>
              new S3AttachmentStorage(
                settings,
                new S3Client({
                  region: settings.region,
                  endpoint: settings.endpoint,
                  pathStyle: settings.pathStyle,
                  credentials: dependencies.s3Credentials!,
                }),
              ),
          }
        : {}),
      log: dependencies.log ?? (() => undefined),
    }),
  };
}
