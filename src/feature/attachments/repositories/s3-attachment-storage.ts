import type { S3Client } from '../../../platform/s3/client.ts';
import type { AttachmentSettings } from '../../swarm-config/types/index.ts';

import type { AttachmentStorage } from './attachment-storage.ts';

/** S3 objects are addressed by attachment id, independently of a queue item or run. */
export class S3AttachmentStorage implements AttachmentStorage {
  private readonly settings: AttachmentSettings['s3'];
  private readonly client: S3Client;

  constructor(settings: AttachmentSettings['s3'], client: S3Client) {
    this.settings = settings;
    this.client = client;
  }

  handles(uri: string): boolean {
    return uri.startsWith('s3:');
  }

  async put(_owner: string, id: string, bytes: Buffer): Promise<string> {
    const bucket = this.settings.bucket;
    if (!bucket) throw new Error('S3 bucket is not configured');
    const key = `${this.settings.prefix}${id}`;
    await this.client.put(bucket, key, bytes);
    return `s3://${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async get(uri: string): Promise<Buffer | null> {
    const address = this.address(uri);
    return address ? this.client.get(address.bucket, address.key) : null;
  }

  async remove(uri: string): Promise<void> {
    const address = this.address(uri);
    if (address) await this.client.delete(address.bucket, address.key);
  }

  async sweep(_keep: Map<string, string[]>): Promise<void> {
    // Never list a bucket: it may be shared with other installations.
  }

  private address(uri: string): { bucket: string; key: string } | null {
    try {
      // Do not use URL here: it normalizes dot segments before we can recover the original key.
      const match = /^s3:\/\/([^/?#]+)\/(.+)$/.exec(uri);
      if (!match || /[?#]/.test(match[2]!)) return null;
      const key = match[2]!.split('/').map(decodeURIComponent).join('/');
      return key ? { bucket: match[1]!, key } : null;
    } catch {
      return null;
    }
  }
}
