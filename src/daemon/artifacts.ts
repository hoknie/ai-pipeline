import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Where the bytes of step artifacts live. The database keeps only the URI a `put` returned, so a
 * remote storage (`s3:`) can be added next to the file one without changing the schema.
 */
export interface ArtifactStorage {
  /** Whether this storage owns the URI. */
  handles(uri: string): boolean;
  put(runId: string, key: string, bytes: Buffer): Promise<string>;
  /** The bytes behind the URI; null when they are gone or the scheme is unknown. */
  get(uri: string): Promise<Buffer | null>;
  remove(uri: string): Promise<void>;
  /** Removes everything that does not belong to `keep` (run id → URIs of its artifacts). */
  sweep(keep: Map<string, string[]>): Promise<void>;
}

/** Artifacts as files: `<root>/<run-id>/<artifact-id>`, URI `file:///…`. */
export class FileArtifactStorage implements ArtifactStorage {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  handles(uri: string): boolean {
    return uri.startsWith('file:');
  }

  async put(runId: string, key: string, bytes: Buffer): Promise<string> {
    const directory = join(this.root, runId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, key);
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes, { mode: 0o600 });
    renameSync(temporary, path);
    return pathToFileURL(path).href;
  }

  async get(uri: string): Promise<Buffer | null> {
    const path = this.pathOf(uri);
    if (path === null) return null;
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  }

  async remove(uri: string): Promise<void> {
    const path = this.pathOf(uri);
    if (path !== null) rmSync(path, { force: true });
  }

  async sweep(keep: Map<string, string[]>): Promise<void> {
    let runs: string[];
    try {
      runs = readdirSync(this.root);
    } catch {
      return;
    }
    for (const run of runs) {
      const directory = join(this.root, run);
      const uris = keep.get(run);
      if (uris === undefined) {
        rmSync(directory, { recursive: true, force: true });
        continue;
      }
      const kept = new Set(uris.map((uri) => this.pathOf(uri)).filter((path) => path !== null));
      let files: string[];
      try {
        files = readdirSync(directory);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!kept.has(join(directory, file))) rmSync(join(directory, file), { force: true });
      }
    }
  }

  /** The path inside the root for a `file:` URI; null for anything else. */
  private pathOf(uri: string): string | null {
    if (!this.handles(uri)) return null;
    try {
      const path = fileURLToPath(uri);
      return path.startsWith(this.root + sep) ? path : null;
    } catch {
      return null;
    }
  }
}

/** Picks the storage that owns the URI; null for an unknown scheme. */
export function artifactStorageFor(
  storages: ArtifactStorage[],
  uri: string,
): ArtifactStorage | null {
  return storages.find((storage) => storage.handles(uri)) ?? null;
}
