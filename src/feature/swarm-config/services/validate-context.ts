import type { FieldError } from '../types/index.ts';
import { parseDuration } from '../types/duration.ts';
import { isMapping } from '../types/merge.ts';
import { tagNameProblem } from '../types/tag-names.ts';

/** Collects the errors of one validation run. */
export interface ValidateContext {
  errors: FieldError[];
}

type Mapping = Record<string, unknown>;

export type Range = readonly [number, number];

export function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

export function addError(ctx: ValidateContext, path: string, message: string): void {
  ctx.errors.push({ path, message });
}

export function readMapping(ctx: ValidateContext, value: unknown, path: string): Mapping | null {
  if (isMapping(value)) return value;
  addError(ctx, path, 'must be a mapping');
  return null;
}

export function readEntries(
  ctx: ValidateContext,
  mapping: Mapping,
  path: string,
  allowed: string[] | null,
): [string, unknown][] {
  return Object.entries(mapping).filter(([key]) => {
    if (allowed === null || allowed.includes(key)) return true;
    addError(ctx, join(path, key), 'unknown key');
    return false;
  });
}

export function readString(ctx: ValidateContext, value: unknown, path: string): string | null {
  if (typeof value !== 'string') {
    addError(ctx, path, 'must be a string');
    return null;
  }
  if (value.trim() === '') {
    addError(ctx, path, 'must not be empty');
    return null;
  }
  return value;
}

export function readStrings(ctx: ValidateContext, value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    addError(ctx, path, 'must be a list of strings');
    return [];
  }
  return value.flatMap((item, index) => readString(ctx, item, `${path}[${index}]`) ?? []);
}

export function checkTagNames(ctx: ValidateContext, value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    addError(ctx, path, 'must be a list of strings');
    return;
  }
  for (const [index, item] of value.entries()) {
    const problem = tagNameProblem(item);
    if (problem !== null) addError(ctx, path, `item ${index + 1} ${problem}`);
  }
}

export function readInteger(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  [low, high]: Range,
): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high) {
    return value;
  }
  addError(ctx, path, `must be an integer from ${low} to ${high}`);
  return null;
}

export function readChoice<T extends string>(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  options: readonly T[],
): T | null {
  const text = readString(ctx, value, path);
  if (text === null) return null;
  if ((options as readonly string[]).includes(text)) return text as T;
  addError(ctx, path, `must be one of ${options.join(', ')}`);
  return null;
}

export function readTimeout(ctx: ValidateContext, value: unknown, path: string): number | null {
  const text = readString(ctx, value, path);
  if (text === null) return null;
  const seconds = parseDuration(text);
  if (seconds === null) addError(ctx, path, 'must be a positive duration such as 90s, 30m or 2h');
  return seconds;
}

export function readBoolean(ctx: ValidateContext, value: unknown, path: string): boolean | null {
  if (typeof value === 'boolean') return value;
  addError(ctx, path, 'must be true or false');
  return null;
}

export function readKnown(
  ctx: ValidateContext,
  value: unknown,
  path: string,
  known: string[],
): string | null {
  const slug = readString(ctx, value, path);
  if (slug !== null && !known.includes(slug)) {
    addError(ctx, path, `unknown specialist \`${slug}\`; known: ${known.join(', ')}`);
  }
  return slug;
}
