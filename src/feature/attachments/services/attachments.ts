import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { rejected } from '../../../platform/errors/index.ts';
import type { S3Credentials } from '../../../platform/s3/client.ts';
import { workspaceRoot } from '../../../platform/git/index.ts';
import type { Run } from '../../runs/types/index.ts';
import type { AttachmentSettings } from '../../swarm-config/types/index.ts';
import {
  attachmentStorageFor,
  type AttachmentRecord,
  type AttachmentRepository,
  type AttachmentStorage,
} from '../repositories/index.ts';
import type { AttachmentRef, AttachmentsLiveness, AttachmentSource } from '../types/index.ts';

import { newAttachmentId, newRecord, prepareSources, readPrepared } from './ingest.ts';

export interface AttachmentDependencies {
  attachments: AttachmentRepository;
  storages: AttachmentStorage[];
  now: () => number;
  attachmentSettings?: () => AttachmentSettings | string;
  s3Credentials?: S3Credentials | null;
  s3Storage?: (settings: AttachmentSettings['s3']) => AttachmentStorage;
  log?: (message: string) => void;
}

/** What `content` returns: the file and its bytes. */
export interface AttachmentContent extends AttachmentRef {
  bytes: Buffer;
}

function refOf(record: AttachmentRecord): AttachmentRef {
  return {
    id: record.id,
    fileName: record.fileName,
    size: record.size,
    mediaType: record.mediaType,
  };
}

/** Files attached to tasks: accepted into the storage, handed to the run, laid out for agents. */
export class AttachmentService {
  private readonly dependencies: AttachmentDependencies;

  constructor(dependencies: AttachmentDependencies) {
    this.dependencies = dependencies;
  }

  /** Only the presence of daemon credentials is exposed to the panel. */
  hasS3Credentials(): boolean {
    return (
      this.dependencies.s3Credentials !== null && this.dependencies.s3Credentials !== undefined
    );
  }

  /** The attachments of a queue item, in the order they were attached. */
  listOf(itemId: string): AttachmentRef[] {
    return this.dependencies.attachments.ofItem(itemId).map(refOf);
  }

  /** The attachments a run was created with. */
  listOfRun(runId: string): AttachmentRef[] {
    return this.dependencies.attachments.ofRun(runId).map(refOf);
  }

  /**
   * Accepts files for a queue item; with `detach` also drops attachments of the item by name.
   * Everything is checked before anything is written, and a failure leaves nothing behind.
   * Returns the new attachments.
   */
  async ingest(params: {
    repository: string;
    itemId: string;
    sources: AttachmentSource[];
    detach?: string[];
  }): Promise<AttachmentRef[]> {
    const { attachments, now } = this.dependencies;
    const own = attachments.ofItem(params.itemId).filter((record) => record.runId === null);
    const dropped = params.detach ?? [];
    for (const name of dropped) {
      if (!own.some((record) => record.fileName === name)) {
        throw rejected(`the task has no attachment \`${name}\``);
      }
    }
    const kept = own.filter((record) => !dropped.includes(record.fileName));
    const prepared = prepareSources(
      params.sources,
      kept.map((record) => record.fileName),
    );
    const written: { uri: string; storage: AttachmentStorage }[] = [];
    const records: AttachmentRecord[] = [];
    let replaced: AttachmentRecord[] = [];
    try {
      const storage = prepared.length ? this.defaultStorage() : null;
      for (const file of prepared) {
        const bytes = await readPrepared(file);
        const id = newAttachmentId();
        const uri = await storage!.put(params.itemId, id, bytes);
        written.push({ uri, storage: storage! });
        records.push(
          newRecord(file, bytes, {
            repository: params.repository,
            itemId: params.itemId,
            uri,
            id,
            now: now(),
          }),
        );
      }
      const removing = own.filter((record) => dropped.includes(record.fileName));
      attachments.add(
        records,
        removing.map((record) => record.id),
      );
      replaced = removing;
    } catch (error) {
      for (const item of written) {
        await item.storage
          .remove(item.uri)
          .catch((failure: unknown) => this.logStorageError(failure));
      }
      throw error;
    }
    await this.removeBytes(replaced);
    return records.map(refOf);
  }

  /** Drops attachments of a queue item by name and deletes their bytes. */
  async detach(itemId: string, names: string[]): Promise<void> {
    const removed = this.dependencies.attachments.removeOfItem(itemId, names);
    await this.removeBytes(removed);
  }

  /** The item became a run: its attachments belong to the run now; no bytes are copied. */
  bindToRun(itemId: string, runId: string): void {
    this.dependencies.attachments.bindToRun(itemId, runId);
  }

  /** The item left the queue without becoming a run: its attachments are deleted. */
  async removeOwner(itemId: string): Promise<void> {
    await this.removeBytes(this.dependencies.attachments.removeOfItem(itemId));
  }

  /** The file and its bytes; rejected when the run has no such attachment or the bytes are gone. */
  async content(runId: string, id: string): Promise<AttachmentContent> {
    const record = this.dependencies.attachments.inRun(runId, id);
    if (!record) throw rejected(`unknown attachment \`${id}\``);
    const bytes = await this.bytesOf(record);
    if (bytes === null) throw rejected(`attachment \`${record.fileName}\` is not available`);
    return { ...refOf(record), bytes };
  }

  /**
   * Lays the attachments of the run out as files in `<workspace>/logs/<run>/_attachments/`, outside
   * every worktree, and returns the folder; null for a run without attachments. Every call writes
   * each file from the storage again, so a changed copy never survives.
   */
  async materialize(run: Run): Promise<string | null> {
    if (run.attachments.length === 0) return null;
    const directory = join(
      workspaceRoot(run.repository, run.config.workspaceDir),
      'logs',
      run.id,
      '_attachments',
    );
    mkdirSync(directory, { recursive: true });
    for (const ref of run.attachments) {
      const record = this.dependencies.attachments.byId(ref.id);
      const bytes = record ? await this.bytesOf(record) : null;
      if (bytes === null) throw new Error(`attachment ${ref.fileName} is not available`);
      const path = join(directory, ref.fileName);
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, bytes, { mode: 0o600 });
      renameSync(temporary, path);
    }
    return directory;
  }

  /**
   * Deletes the records without a queue item or a run, then the stored files no record names.
   * Links of a scheme no storage knows are left alone.
   */
  async sweep(live: AttachmentsLiveness): Promise<void> {
    const { attachments } = this.dependencies;
    const orphans = attachments
      .all()
      .filter((record) =>
        record.runId === null ? !live.items.has(record.itemId) : !live.hasRun(record.runId),
      );
    await this.removeBytes(orphans);
    attachments.removeRecords(orphans.map((record) => record.id));
    const keep = new Map<string, string[]>();
    for (const record of attachments.all()) {
      keep.set(record.itemId, [...(keep.get(record.itemId) ?? []), record.uri]);
    }
    for (const storage of this.storages()) {
      await storage.sweep(keep).catch((error: unknown) => this.logStorageError(error));
    }
  }

  private defaultStorage(): AttachmentStorage {
    const settings = this.dependencies.attachmentSettings?.();
    if (typeof settings === 'string') throw rejected(settings);
    if (settings?.storage === 's3') {
      if (!this.dependencies.s3Credentials) {
        throw rejected('no S3 credentials in the daemon environment');
      }
      if (!this.dependencies.s3Storage) throw new Error('S3 attachment storage is not wired');
      return this.dependencies.s3Storage(settings.s3);
    }
    const storage = this.dependencies.storages[0];
    if (!storage) throw new Error('no attachment storage');
    return storage;
  }

  private async bytesOf(record: AttachmentRecord): Promise<Buffer | null> {
    const storage = attachmentStorageFor(this.storages(), record.uri);
    try {
      return storage ? await storage.get(record.uri) : null;
    } catch (error) {
      this.logStorageError(error);
      return null;
    }
  }

  private async removeBytes(records: AttachmentRecord[]): Promise<void> {
    for (const record of records) {
      const storage = attachmentStorageFor(this.storages(), record.uri);
      if (storage)
        await storage.remove(record.uri).catch((error: unknown) => this.logStorageError(error));
    }
  }

  private storages(): AttachmentStorage[] {
    const settings = this.dependencies.attachmentSettings?.();
    const credentials = this.dependencies.s3Credentials;
    return typeof settings !== 'string' && settings && credentials && this.dependencies.s3Storage
      ? [...this.dependencies.storages, this.dependencies.s3Storage(settings.s3)]
      : this.dependencies.storages;
  }

  private logStorageError(error: unknown): void {
    this.dependencies.log?.(
      `attachment storage: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
