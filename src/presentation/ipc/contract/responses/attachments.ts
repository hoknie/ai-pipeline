export type { AttachmentRef as AttachmentView } from '../../../../feature/attachments/types/index.ts';

/** Answer to `attachment`: the file with its bytes. */
export interface AttachmentContentView {
  fileName: string;
  mediaType: string;
  size: number;
  base64: string;
}
