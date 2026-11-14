import { join } from 'node:path';

import type { Database } from '../../../platform/sqlite/index.ts';
import { AttachmentRepository, FileAttachmentStorage } from '../repositories/index.ts';

import { AttachmentService } from './attachments.ts';

export interface AttachmentsServices {
  attachments: AttachmentService;
}

export function createAttachmentsServices(dependencies: {
  database: Database;
  /** The state directory: attachments are kept in its `attachments` folder. */
  stateDirectory: string;
  now: () => number;
}): AttachmentsServices {
  return {
    attachments: new AttachmentService({
      attachments: new AttachmentRepository(dependencies.database),
      storages: [new FileAttachmentStorage(join(dependencies.stateDirectory, 'attachments'))],
      now: dependencies.now,
    }),
  };
}
