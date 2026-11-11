import { key } from '../types/editor.ts';
import { Document, isMap, isScalar, parseDocument } from 'yaml';
import {
  assembleLevel,
  parseYaml,
  validateNetworkSection,
  validateRuntimesSection,
  validateWebSection,
} from '../../swarm-config/services/index.ts';
import {
  type ConfigPaths,
  type ConfigSource,
  type FieldError,
  isMapping,
  parseDuration,
} from '../../swarm-config/types/index.ts';
import { readText, revisionOf, settingsFile } from '../repositories/documents.ts';
import { readLevels, resolution } from './levels.ts';
import {
  ConfigEditError,
  type EditPlan,
  type SettingField,
  type SettingRequest,
  type SettingsRequest,
  type WriteLevel,
  type SettingValue,
} from '../types/editor.ts';
import { isEnvVariable, SETTING_FIELDS, settingFieldOf } from '../types/setting-fields.ts';

/** Text of settings.yaml with one field set (or removed); comments and other keys survive. */
export function editSetting(text: string | undefined, path: string, value: SettingValue): string {
  const keys = path.split('.');
  if (text === undefined || text.trim() === '') {
    if (value === null) return text ?? '';
    const fresh = new Document({});
    fresh.setIn(keys, value);
    return `${text ?? ''}${fresh.toString({ lineWidth: 0 })}`;
  }
  const document = parseDocument(text, { merge: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new ConfigEditError(`the file has a syntax error: ${document.errors[0]?.message ?? ''}`);
  }
  if (!isMap(document.contents)) {
    if (
      document.contents !== null &&
      !(isScalar(document.contents) && document.contents.value === null)
    ) {
      throw new ConfigEditError('the file must contain a mapping');
    }
    document.contents = document.createNode({}) as never;
  }
  if (value === null) {
    document.deleteIn(keys);
    const parent = document.getIn(keys.slice(0, -1), true);
    if (keys.length > 1 && isMap(parent) && parent.items.length === 0) {
      document.deleteIn(keys.slice(0, -1));
    }
  } else {
    document.setIn(keys, value);
  }
  return document.toString({ lineWidth: 0 });
}

function textError(value: unknown): string | null {
  if (typeof value !== 'string') return 'must be a string';
  return value.trim() === '' ? 'must not be empty' : null;
}

/** Why the value does not fit the field: the message and the path suffix (`[1]` for a list item), or null. */
function settingTypeError(
  setting: SettingField,
  value: SettingValue,
): { message: string; suffix: string } | null {
  if (value === null) return null;
  const fail = (message: string, suffix = '') => ({ message, suffix });
  switch (setting.kind) {
    case 'boolean':
      return typeof value === 'boolean' ? null : fail('must be true or false');
    case 'choice': {
      const options = setting.options ?? [];
      const message = textError(value);
      if (message !== null) return fail(message);
      return options.includes(value as string)
        ? null
        : fail(`must be one of ${options.join(', ')}`);
    }
    case 'integer': {
      const [low, high] = setting.range ?? [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
      return typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high
        ? null
        : fail(`must be an integer from ${low} to ${high}`);
    }
    case 'duration': {
      const message = textError(value);
      if (message !== null) return fail(message);
      return parseDuration(value as string) === null
        ? fail('must be a positive duration such as 90s, 30m or 2h')
        : null;
    }
    case 'strings': {
      if (!Array.isArray(value)) return fail('must be a list of strings');
      for (const [index, item] of value.entries()) {
        const message = textError(item);
        if (message !== null) return fail(message, `[${index}]`);
      }
      return null;
    }
    case 'env':
      if (!isEnvVariable(setting.path)) return fail('cannot be written as a whole');
      return typeof value === 'string' ? null : fail('must be a string');
    case 'string':
    case 'specialist': {
      const message = textError(value);
      return message === null ? null : fail(message);
    }
  }
}

function valueErrors(
  file: string,
  level: WriteLevel,
  entries: [string, SettingValue][],
): FieldError[] {
  const typeErrors: FieldError[] = [];
  for (const [path, value] of entries) {
    const setting = settingFieldOf(path) as SettingField;
    if (setting.globalOnly && level === 'project') {
      typeErrors.push({
        file,
        path: `swarm.${path}`,
        message: 'is read only from the shared settings.yaml',
      });
      continue;
    }
    const problem = settingTypeError(setting, value);
    if (problem !== null) {
      typeErrors.push({ file, path: `swarm.${path}${problem.suffix}`, message: problem.message });
    }
  }
  return typeErrors;
}

/**
 * Checks a write of several settings without writing: the types of all values, the revision, then
 * the whole configuration with all of the edits applied to one text.
 */
export function planSettings(paths: ConfigPaths, request: SettingsRequest): EditPlan {
  const level = request.level ?? 'global';
  const entries = Object.entries(request.values);
  if (entries.length === 0) throw new ConfigEditError('there is nothing to write');
  const unknown = entries.filter(([path]) => settingFieldOf(path) === undefined).map(([p]) => p);
  if (unknown.length > 0) {
    throw new ConfigEditError(
      `${unknown.map((path) => `\`${path}\``).join(', ')} cannot be written; allowed: ${SETTING_FIELDS.map((setting) => setting.path).join(', ')}`,
    );
  }
  const file = settingsFile(paths, level);
  const typeErrors = valueErrors(file, level, entries);
  if (typeErrors.length > 0) return { ok: false, reason: 'invalid', errors: typeErrors };
  const current = readText(file);
  if (revisionOf(current) !== request.revision) {
    return {
      ok: false,
      reason: 'conflict',
      message:
        current === undefined
          ? `${file} does not exist any more`
          : request.revision === null
            ? `${file} already exists`
            : `${file} was changed after it was read`,
    };
  }
  let text = current;
  try {
    for (const [path, value] of entries) text = editSetting(text, path, value);
  } catch (error) {
    if (!(error instanceof ConfigEditError)) throw error;
    return {
      ok: false,
      reason: 'invalid',
      errors: [{ file, path: `swarm.${entries[0]?.[0] ?? ''}`, message: error.message }],
    };
  }
  const written = text ?? '';
  const files = readLevels(paths);
  const before = resolution(assembleLevel(files.global), assembleLevel(files.project));
  const settings: ConfigSource = { path: file, value: parseYaml(written, file), text: written };
  const drafted = { ...files, [level]: { ...files[level], settings } };
  const after = resolution(assembleLevel(drafted.global), assembleLevel(drafted.project));
  const known = new Set(before.errors.map(key));
  const added = after.errors.filter((error) => !known.has(key(error)));
  if (
    level === 'global' &&
    entries.some(([path]) => (settingFieldOf(path) as SettingField).globalOnly)
  ) {
    const sectionErrors = (source: ConfigSource | undefined): FieldError[] => {
      const root = isMapping(source?.value) ? source.value : {};
      return [
        ...validateNetworkSection(root.network).errors,
        ...validateWebSection(root.web).errors,
        ...validateRuntimesSection(root.runtimes).errors,
      ];
    };
    const sectionKnown = new Set(sectionErrors(files.global.settings).map(key));
    const seen = new Set([...known, ...added.map(key)]);
    for (const error of sectionErrors(settings)) {
      if (sectionKnown.has(key(error)) || seen.has(key(error))) continue;
      added.push({ ...error, file });
    }
  }
  if (added.length > 0) return { ok: false, reason: 'invalid', errors: added };
  return { ok: true, file, text: written, revision: revisionOf(written) };
}

/** Checks a write of one setting without writing: the revision, then the whole configuration. */
export function planSetting(paths: ConfigPaths, request: SettingRequest): EditPlan {
  return planSettings(paths, {
    values: { [request.path]: request.value },
    revision: request.revision,
    ...(request.level ? { level: request.level } : {}),
  });
}
