import { statSync } from 'node:fs';
import { join } from 'node:path';

import { parseYaml, readYaml } from '../../repositories/config-files.ts';
import {
  ACCESS_FILE_NAME,
  defaultAccessPolicy,
  type AccessPolicy,
} from '../../types/access/index.ts';
import { ConfigLoadError, type FieldError } from '../../types/errors.ts';
import type { ConfigPaths } from '../../types/levels.ts';
import { validateAccessPolicy, type ActionCatalog } from './validate.ts';

/** `access.yaml` lies next to the shared `settings.yaml`. */
export function accessFilePath(paths: ConfigPaths): string {
  return join(paths.global.directory, ACCESS_FILE_NAME);
}

/** The text of the errors of a file: one line per field, with its path. */
export function describeAccessErrors(path: string, errors: FieldError[]): string {
  return [`invalid ${path}:`, ...errors.map((error) => `  - ${error.path}: ${error.message}`)].join(
    '\n',
  );
}

/** Reads and checks `access.yaml`; a missing file is the default policy; throws `ConfigLoadError`. */
export function loadAccessPolicy(paths: ConfigPaths, catalog: ActionCatalog): AccessPolicy {
  const path = accessFilePath(paths);
  const read = readYaml(path);
  if (!read.found) return defaultAccessPolicy();
  const { policy, errors } = validateAccessPolicy(read.value, catalog);
  if (errors.length > 0) {
    throw new ConfigLoadError({
      kind: 'invalid',
      errors: errors.map((error) => ({ ...error, file: path })),
    });
  }
  return policy;
}

/** Checks a text as the content of `access.yaml` (without the file system). */
export function checkAccessText(
  text: string,
  catalog: ActionCatalog,
): { policy: AccessPolicy; errors: FieldError[] } {
  return validateAccessPolicy(parseYaml(text, ACCESS_FILE_NAME), catalog);
}

/** The modification time of the file; `null` when it is not there. */
function modifiedAt(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

export const ACCESS_RELOAD_MS = 10_000;

/**
 * The policy in effect: the file is looked at again when it is asked for, but not more often than
 * every 10 seconds, and only read when its time changed. A file with an error leaves the last good
 * version in force and writes the error to the log once.
 */
export class AccessPolicySource {
  private readonly paths: () => ConfigPaths;
  private readonly catalog: ActionCatalog;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private policy: AccessPolicy = defaultAccessPolicy();
  private seen: number | null | undefined;
  private lookedAt = Number.NEGATIVE_INFINITY;

  constructor(dependencies: {
    paths: () => ConfigPaths;
    catalog: ActionCatalog;
    now: () => number;
    log: (message: string) => void;
  }) {
    this.paths = dependencies.paths;
    this.catalog = dependencies.catalog;
    this.now = dependencies.now;
    this.log = dependencies.log;
  }

  /** The policy now. */
  current(): AccessPolicy {
    const at = this.now();
    if (at - this.lookedAt < ACCESS_RELOAD_MS) return this.policy;
    this.lookedAt = at;
    const paths = this.paths();
    const modified = modifiedAt(accessFilePath(paths));
    if (modified === this.seen) return this.policy;
    this.seen = modified;
    try {
      this.policy = loadAccessPolicy(paths, this.catalog);
    } catch (error) {
      this.log(
        `access: keeping the previous policy, ${accessFilePath(paths)} is not valid: ${(error as Error).message}`,
      );
    }
    return this.policy;
  }
}
