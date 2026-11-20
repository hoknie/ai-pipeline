import { randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { readZip } from '../../../platform/archive/index.ts';
import { CACHE_RETENTION_MS, skillNameOf } from '../types/index.ts';

const INVALID = 'invalid archive';

/** A downloaded version that cannot be kept; the message is the reason for the warning. */
export class SkillArchiveError extends Error {
  constructor() {
    super(INVALID);
    this.name = 'SkillArchiveError';
  }
}

/**
 * The versions of skills the daemon downloaded: `<root>/<connection>/<name>/<version>/`. A
 * version never changes under its number, so a folder that exists is used without the network.
 */
export class SkillCache {
  private readonly root: string;
  private readonly now: () => number;

  constructor(root: string, now: () => number) {
    this.root = root;
    this.now = now;
  }

  path(connection: string, name: string, version: string): string {
    return join(this.root, connection, name, version);
  }

  /** Whether the version is in the cache; counts as a use of it. */
  has(connection: string, name: string, version: string): boolean {
    const directory = this.path(connection, name, version);
    if (!existsSync(join(directory, 'SKILL.md'))) return false;
    const at = new Date(this.now());
    try {
      utimesSync(directory, at, at);
    } catch {
      // a version in use that cannot be touched is still in use
    }
    return true;
  }

  /** The cached versions of a skill. */
  versions(connection: string, name: string): string[] {
    try {
      return readdirSync(join(this.root, connection, name)).filter((entry) =>
        existsSync(join(this.root, connection, name, entry, 'SKILL.md')),
      );
    } catch {
      return [];
    }
  }

  /**
   * Checks the archive and keeps it: the files go to a temporary folder next to the target and
   * the folder is renamed, so a version is complete or absent. A bad archive writes nothing.
   */
  store(connection: string, name: string, version: string, archive: Buffer): void {
    let files;
    try {
      files = readZip(archive);
    } catch {
      throw new SkillArchiveError();
    }
    const tops = new Set(files.map((file) => file.path.split('/')[0]));
    if (files.length === 0 || tops.size !== 1) throw new SkillArchiveError();
    const [top = ''] = [...tops];
    if (top !== name) throw new SkillArchiveError();
    const manifest = files.find((file) => file.path === `${top}/SKILL.md`);
    if (manifest === undefined || skillNameOf(manifest.data.toString('utf8')) !== name) {
      throw new SkillArchiveError();
    }
    const target = this.path(connection, name, version);
    const parent = dirname(target);
    mkdirSync(parent, { recursive: true });
    const temporary = join(parent, `.tmp-${randomUUID()}`);
    try {
      for (const file of files) {
        if (file.path.split('/').length < 2) throw new SkillArchiveError();
        const destination = resolve(temporary, file.path.slice(top.length + 1));
        if (!destination.startsWith(`${temporary}${sep}`)) throw new SkillArchiveError();
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, file.data, { mode: 0o644 });
      }
      try {
        renameSync(temporary, target);
      } catch (error) {
        // another attempt stored the same version first: the same content
        if (!existsSync(join(target, 'SKILL.md'))) throw error;
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  /** Copies the version into `<directory>/.claude/skills/<name>`. */
  copy(connection: string, name: string, version: string, directory: string): void {
    const destination = join(directory, '.claude', 'skills', name);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(this.path(connection, name, version), destination, { recursive: true });
  }

  /** Removes the versions nobody used for the retention time; returns how many. */
  prune(retentionMs = CACHE_RETENTION_MS): number {
    const horizon = this.now() - retentionMs;
    let removed = 0;
    for (const connection of this.children(this.root)) {
      for (const name of this.children(join(this.root, connection))) {
        const skill = join(this.root, connection, name);
        for (const version of this.children(skill)) {
          const directory = join(skill, version);
          if (statSync(directory).mtimeMs >= horizon) continue;
          rmSync(directory, { recursive: true, force: true });
          removed += 1;
        }
        if (this.children(skill).length === 0) rmSync(skill, { recursive: true, force: true });
      }
    }
    return removed;
  }

  private children(directory: string): string[] {
    try {
      return readdirSync(directory);
    } catch {
      return [];
    }
  }
}
