/**
 * The subset of npm semver the skills of a registry use: versions `M.m.p[-pre]`, ranges with `x`,
 * `^`, `~`, comparisons, a space for "and" and `||` for "or". Pure.
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** The identifiers after `-`: numbers and strings. */
  pre: (number | string)[];
}

interface Comparator {
  op: '<' | '<=' | '>' | '>=' | '=';
  version: Version;
}

/** A parsed range: it holds when every comparator of at least one set holds. */
export type VersionRange = Comparator[][];

const NUMBER = '(0|[1-9][0-9]{0,8})';
const IDENTIFIER = '[0-9A-Za-z-]+';
const VERSION = new RegExp(
  `^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?(?:\\+${IDENTIFIER}(?:\\.${IDENTIFIER})*)?$`,
  'u',
);

function identifiers(text: string): (number | string)[] {
  return text.split('.').map((part) => (/^[0-9]+$/u.test(part) ? Number(part) : part));
}

/** The version of a text like `1.4.1` or `2.0.0-rc.1`; null when it is not one. */
export function parseVersion(text: string): Version | null {
  const match = VERSION.exec(text.trim());
  if (match === null) return null;
  const pre = match[4] === undefined ? [] : identifiers(match[4]);
  if (pre.some((part) => typeof part === 'string' && /^0[0-9]+$/u.test(part))) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre };
}

function comparePre(left: (number | string)[], right: (number | string)[]): number {
  // a version without pre-release identifiers is above one with them
  if (left.length === 0) return right.length === 0 ? 0 : 1;
  if (right.length === 0) return -1;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const one = left[index];
    const other = right[index];
    if (one === undefined) return -1;
    if (other === undefined) return 1;
    if (one === other) continue;
    if (typeof one === 'number' && typeof other === 'number') return one < other ? -1 : 1;
    if (typeof one === 'number') return -1;
    if (typeof other === 'number') return 1;
    return one < other ? -1 : 1;
  }
  return 0;
}

export function compareVersions(left: Version, right: Version): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return comparePre(left.pre, right.pre);
}

/** The parts of one comparator text: `null` marks a wildcard. */
interface Parts {
  major: number | null;
  minor: number | null;
  patch: number | null;
  pre: (number | string)[];
}

const WILDCARD = /^[xX*]$/u;
const PART = /^(0|[1-9][0-9]{0,8})$/u;

function partialOf(text: string): Parts | null {
  const [core = '', ...rest] = text.split('-');
  const pre = rest.join('-');
  const parts = core.split('.');
  if (parts.length > 3 || parts.length === 0) return null;
  const numbers: (number | null)[] = [];
  for (const part of parts) {
    if (WILDCARD.test(part)) numbers.push(null);
    else if (PART.test(part)) numbers.push(Number(part));
    else return null;
  }
  while (numbers.length < 3) numbers.push(null);
  // a wildcard hides everything after it
  for (let index = 1; index < 3; index += 1) {
    if (numbers[index - 1] === null && numbers[index] !== null) return null;
  }
  const [major = null, minor = null, patch = null] = numbers;
  if (pre !== '') {
    if (patch === null || rest.length === 0) return null;
    if (!new RegExp(`^${IDENTIFIER}(?:\\.${IDENTIFIER})*$`, 'u').test(pre)) return null;
    return { major, minor, patch, pre: identifiers(pre) };
  }
  return { major, minor, patch, pre: [] };
}

const at = (
  major: number,
  minor: number,
  patch: number,
  pre: (number | string)[] = [],
): Version => ({
  major,
  minor,
  patch,
  pre,
});

/** The first version that no longer belongs to the range: its pre-releases do not belong either. */
const below = (major: number, minor: number, patch: number): Comparator => ({
  op: '<',
  version: at(major, minor, patch, [0]),
});
const from = (
  major: number,
  minor: number,
  patch: number,
  pre: (number | string)[] = [],
): Comparator => ({
  op: '>=',
  version: at(major, minor, patch, pre),
});

function caret(value: Parts): Comparator[] | null {
  const { major, minor, patch } = value;
  if (major === null) return [];
  const low = from(major, minor ?? 0, patch ?? 0, value.pre);
  if (major > 0 || minor === null) return [low, below(major + 1, 0, 0)];
  if (minor > 0 || patch === null) return [low, below(0, minor + 1, 0)];
  return [low, below(0, 0, patch + 1)];
}

function tilde(value: Parts): Comparator[] {
  const { major, minor, patch } = value;
  if (major === null) return [];
  const low = from(major, minor ?? 0, patch ?? 0, value.pre);
  return minor === null ? [low, below(major + 1, 0, 0)] : [low, below(major, minor + 1, 0)];
}

function exact(value: Parts): Comparator[] {
  const { major, minor, patch } = value;
  if (major === null) return [];
  if (minor === null) return [from(major, 0, 0), below(major + 1, 0, 0)];
  if (patch === null) return [from(major, minor, 0), below(major, minor + 1, 0)];
  return [{ op: '=', version: at(major, minor, patch, value.pre) }];
}

function compared(op: '<' | '<=' | '>' | '>=', value: Parts): Comparator[] | null {
  const { major, minor, patch } = value;
  if (major === null) return op === '<' || op === '>' ? null : [];
  const lowest = at(major, minor ?? 0, patch ?? 0, value.pre);
  if (patch !== null) return [{ op, version: lowest }];
  // a partial version stands for the whole span of it
  const next = minor === null ? at(major + 1, 0, 0, [0]) : at(major, minor + 1, 0, [0]);
  switch (op) {
    case '>=':
      return [{ op: '>=', version: lowest }];
    case '<':
      return [{ op: '<', version: lowest }];
    case '>':
      return [{ op: '>=', version: next }];
    case '<=':
      return [{ op: '<', version: next }];
  }
}

function comparatorsOf(token: string): Comparator[] | null {
  const match = /^(\^|~>?|>=|<=|>|<|=)?(.+)$/u.exec(token);
  if (match === null) return null;
  const value = partialOf(match[2] ?? '');
  if (value === null) return null;
  switch (match[1]) {
    case '^':
      return caret(value);
    case '~':
    case '~>':
      return tilde(value);
    case '>=':
    case '<=':
    case '>':
    case '<':
      return compared(match[1], value);
    default:
      return exact(value);
  }
}

/** The range of a text like `^1.2`, `1.x`, `>=1 <3` or `1.2.3 || ^2`; null when it is not valid. */
export function parseRange(text: string): VersionRange | null {
  if (text.length > 256) return null;
  const sets: VersionRange = [];
  for (const part of text.split('||')) {
    const tokens = part
      .replace(/(\^|~>?|>=|<=|>|<|=)\s+/gu, '$1')
      .split(/\s+/u)
      .filter((token) => token !== '');
    const set: Comparator[] = [];
    for (const token of tokens) {
      const comparators = comparatorsOf(token);
      if (comparators === null) return null;
      set.push(...comparators);
    }
    sets.push(set);
  }
  return sets;
}

function holds({ op, version }: Comparator, candidate: Version): boolean {
  const order = compareVersions(candidate, version);
  switch (op) {
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
    case '=':
      return order === 0;
  }
}

function inSet(set: Comparator[], candidate: Version): boolean {
  if (!set.every((comparator) => holds(comparator, candidate))) return false;
  if (candidate.pre.length === 0) return true;
  // a pre-release is chosen only when the range names a pre-release of the same x.y.z
  return set.some(
    ({ version }) =>
      version.pre.length > 0 &&
      version.major === candidate.major &&
      version.minor === candidate.minor &&
      version.patch === candidate.patch,
  );
}

export function satisfies(version: Version, range: VersionRange): boolean {
  return range.some((set) => inSet(set, version));
}

/**
 * The highest of the versions (texts) that the range admits; without a range, the highest
 * version that is not a pre-release. Texts that are not versions are skipped. Null when none fits.
 */
export function maxSatisfying(versions: readonly string[], range: string | null): string | null {
  const parsed = parseRange(range ?? '*');
  if (parsed === null) return null;
  let best: { text: string; version: Version } | null = null;
  for (const text of versions) {
    const version = parseVersion(text);
    if (version === null || !satisfies(version, parsed)) continue;
    if (best === null || compareVersions(version, best.version) > 0) best = { text, version };
  }
  return best?.text ?? null;
}

/** The versions of the texts from the highest down, texts that are not versions left out. */
export function sortVersionsDescending(versions: readonly string[]): string[] {
  return versions
    .flatMap((text) => {
      const version = parseVersion(text);
      return version === null ? [] : [{ text, version }];
    })
    .sort((left, right) => compareVersions(right.version, left.version))
    .map((entry) => entry.text);
}
