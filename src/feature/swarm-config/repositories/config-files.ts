import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { stem } from '../types/levels.ts';
import { ConfigLoadError, type FieldError } from '../types/errors.ts';
import {
  ACTIONS_DIR,
  LEGACY_PIPELINES_DIR,
  type LevelFiles,
  type LevelPaths,
  PIPELINES_DIR,
  SETTINGS_NAME,
  SPECIALISTS_DIR,
} from '../types/levels.ts';
import { type ConfigSource, isMapping } from '../types/merge.ts';

/** Reads settings.yaml, specialists/*.yaml, pipelines/*.yaml and actions/*.yaml of a level directory. */
export function readLevel(paths: LevelPaths, options: { tolerant?: boolean } = {}): LevelFiles {
  const problems: FieldError[] = [];
  const legacy: string[] = [];
  const pick = (
    directories: string[],
    section: string,
    only?: string,
    canonical?: (value: unknown) => unknown,
  ): ConfigSource[] => {
    const byStem = new Map<string, string[]>();
    for (const directory of directories) {
      for (const name of listYaml(directory, only)) {
        const key = stem(name);
        byStem.set(key, [...(byStem.get(key) ?? []), join(directory, name)]);
      }
    }
    const sources: ConfigSource[] = [];
    for (const [key, group] of byStem) {
      const [first, second] = group;
      if (first !== undefined && second !== undefined) {
        problems.push({
          file: first,
          path: section === '' ? 'swarm' : `swarm.${section}.${key}`,
          message: `defined by two files, ${first} and ${second}; keep one`,
        });
        continue;
      }
      if (first === undefined) continue;
      try {
        const read = readYaml(first);
        if (read.found) {
          const value = canonical === undefined ? read.value : canonical(read.value);
          sources.push({ path: first, value, text: read.text });
          if (canonical !== undefined && hasLegacySplit(read.value)) legacy.push(first);
        }
      } catch (error) {
        if (!options.tolerant || !(error instanceof ConfigLoadError)) throw error;
        problems.push({
          file: first,
          path: section === '' ? 'swarm' : `swarm.${section}.${key}`,
          message: error.message,
        });
      }
    }
    return sources;
  };
  const settings = pick([paths.directory], '', SETTINGS_NAME);
  const specialists = pick([join(paths.directory, SPECIALISTS_DIR)], 'specialists');
  const legacyDirectory = join(paths.directory, LEGACY_PIPELINES_DIR);
  const pipelines = pick(
    [join(paths.directory, PIPELINES_DIR), legacyDirectory],
    'pipelines',
    undefined,
    canonicalPipeline,
  );
  for (const source of pipelines) {
    if (source.path.startsWith(`${legacyDirectory}/`) && !legacy.includes(source.path)) {
      legacy.push(source.path);
    }
  }
  const actions = pick([join(paths.directory, ACTIONS_DIR)], 'actions');
  const [first] = settings;
  return {
    ...(first ? { settings: first } : {}),
    specialists,
    pipelines,
    actions,
    problems,
    legacy: legacy.sort(),
  };
}

function hasLegacySplit(value: unknown): boolean {
  return isMapping(value) && isMapping(value.split) && 'workflow' in value.split;
}

/** Moves the old `split.workflow` key to `split.pipeline`; with both keys the value stays for validation to reject. */
export function canonicalPipeline(value: unknown): unknown {
  if (!hasLegacySplit(value) || !isMapping(value)) return value;
  const split = value.split as Record<string, unknown>;
  if ('pipeline' in split) return value;
  const { workflow, ...rest } = split;
  return { ...value, split: { ...rest, pipeline: workflow } };
}

/** *.yaml and *.yml files of a directory by code point; only `name` when given. */
export function listYaml(directory: string, only?: string): string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw new ConfigLoadError({ kind: 'read', path: directory, message: (error as Error).message });
  }
  return entries
    .filter((entry) => !entry.name.startsWith('.') && /\.ya?ml$/.test(entry.name))
    .filter((entry) => only === undefined || stem(entry.name) === only)
    .filter((entry) => {
      if (entry.isFile()) return true;
      if (!entry.isSymbolicLink()) return false;
      try {
        return statSync(join(directory, entry.name)).isFile();
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function readYaml(path: string): { found: boolean; value: unknown; text: string } {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { found: false, value: undefined, text: '' };
    throw new ConfigLoadError({ kind: 'read', path, message: (error as Error).message });
  }
  return { found: true, value: parseYaml(text, path), text };
}

/** Parses a YAML file; an empty file gives undefined, a syntax error a ConfigLoadError. */
export function parseYaml(text: string, path: string): unknown {
  const document = parseDocument(text, { merge: true, uniqueKeys: true });
  const [first] = document.errors;
  if (first) {
    throw new ConfigLoadError({ kind: 'syntax', path, message: first.message });
  }
  const value: unknown = document.toJS({ maxAliasCount: 100 });
  return value === null ? undefined : value;
}
