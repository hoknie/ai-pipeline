import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { rejected } from '../../../platform/errors/index.ts';
import { workspaceRoot } from '../../../platform/git/index.ts';
import type { Run } from '../../runs/types/index.ts';
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
      const storage = this.defaultStorage();
      for (const file of prepared) {
        const bytes = await readPrepared(file);
        const id = newAttachmentId();
        const uri = await storage.put(params.itemId, id, bytes);
        written.push({ uri, storage });
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
      for (const item of written) await item.storage.remove(item.uri).catch(() => undefined);
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
    const { attachments, storages } = this.dependencies;
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
    for (const storage of storages) await storage.sweep(keep).catch(() => undefined);
  }

  private defaultStorage(): AttachmentStorage {
    const storage = this.dependencies.storages[0];
    if (!storage) throw new Error('no attachment storage');
    return storage;
  }

  private async bytesOf(record: AttachmentRecord): Promise<Buffer | null> {
    const storage = attachmentStorageFor(this.dependencies.storages, record.uri);
    return storage ? await storage.get(record.uri) : null;
  }

  private async removeBytes(records: AttachmentRecord[]): Promise<void> {
    for (const record of records) {
      const storage = attachmentStorageFor(this.dependencies.storages, record.uri);
      if (storage) await storage.remove(record.uri).catch(() => undefined);
    }
  }
}
