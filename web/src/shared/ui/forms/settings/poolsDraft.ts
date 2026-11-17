/** One pool of the form: the name and the selectors are kept as typed, empty ones included. */
export interface PoolDraft {
  name: string;
  max: number | null;
  members: string[];
}

export type PoolProblem =
  | 'emptyName'
  | 'duplicateName'
  | 'noMembers'
  | 'duplicateMember'
  | 'max'
  | 'format'
  | 'noModel'
  | 'overlap';

const PLAIN_SELECTORS = ['claude', 'agy', 'opencode', 'codex', 'kilo', 'cline', 'copilot'];
const MODEL_SELECTOR = /^opencode:([^/\s*]+)\/([^\s*]*)(\*?)$/;

/** What is wrong with a selector as such; the same rules as the daemon's check of the queue. */
export function selectorProblem(selector: string): 'format' | 'noModel' | null {
  if (PLAIN_SELECTORS.includes(selector)) return null;
  const match = MODEL_SELECTOR.exec(selector);
  if (!match) return 'format';
  if (match[3] === '' && match[2] === '') return 'noModel';
  return null;
}

/** Whether two valid selectors can match the same runtime and model. */
export function selectorsOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  const prefix = (selector: string): string | null =>
    selector.endsWith('*') ? selector.slice(0, -1) : null;
  const leftPrefix = prefix(left);
  const rightPrefix = prefix(right);
  if (leftPrefix !== null && rightPrefix !== null) {
    return leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix);
  }
  if (leftPrefix !== null) return right.startsWith(leftPrefix);
  if (rightPrefix !== null) return left.startsWith(rightPrefix);
  return false;
}

export type MemberProblem =
  | { problem: 'format' | 'noModel' | 'duplicateMember' }
  | { problem: 'overlap'; pool: string; with: string };

/**
 * Why `selector` cannot join the pool `poolIndex`: its format, a repeat in the pool, or an overlap
 * with a selector of another pool (named). Null when it can.
 */
export function memberProblem(
  pools: readonly PoolDraft[],
  poolIndex: number,
  selector: string,
): MemberProblem | null {
  const value = selector.trim();
  const format = selectorProblem(value);
  if (format !== null) return { problem: format };
  if (pools[poolIndex]?.members.some((member) => member.trim() === value)) {
    return { problem: 'duplicateMember' };
  }
  for (const [index, other] of pools.entries()) {
    if (index === poolIndex) continue;
    const clash = other.members
      .map((member) => member.trim())
      .find((member) => selectorProblem(member) === null && selectorsOverlap(member, value));
    if (clash !== undefined) return { problem: 'overlap', pool: other.name.trim(), with: clash };
  }
  return null;
}

export const POOL_MAX_RANGE = [1, 32] as const;

const POOLS_PREFIX = 'swarm.queue.pools.';

/** The draft of the pools from the value of the field (the object of the file or of the view). */
export function poolsFromValue(value: unknown): PoolDraft[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([name, pool]) => {
    const body = (pool ?? {}) as { max?: unknown; members?: unknown };
    return {
      name,
      max: typeof body.max === 'number' ? body.max : null,
      members: Array.isArray(body.members)
        ? body.members.filter((member): member is string => typeof member === 'string')
        : [],
    };
  });
}

/** The value to write: the object of the pools; no pools is `null`, which removes the key. */
export function poolsToValue(pools: readonly PoolDraft[]): Record<string, unknown> | null {
  if (pools.length === 0) return null;
  return Object.fromEntries(
    pools.map((pool) => [
      pool.name.trim(),
      { max: pool.max, members: pool.members.map((member) => member.trim()) },
    ]),
  );
}

/** What is wrong with the pools without the configuration: names, selectors and the limit. */
export function poolProblems(
  pools: readonly PoolDraft[],
): { pool: number; member: number | null; problem: PoolProblem }[] {
  const found: { pool: number; member: number | null; problem: PoolProblem }[] = [];
  const names = new Map<string, number>();
  for (const [index, pool] of pools.entries()) {
    const name = pool.name.trim();
    if (name === '') found.push({ pool: index, member: null, problem: 'emptyName' });
    else if (names.has(name)) found.push({ pool: index, member: null, problem: 'duplicateName' });
    names.set(name, index);
    const [low, high] = POOL_MAX_RANGE;
    if (pool.max === null || !Number.isInteger(pool.max) || pool.max < low || pool.max > high)
      found.push({ pool: index, member: null, problem: 'max' });
    const members = pool.members.map((member) => member.trim());
    if (members.filter((member) => member !== '').length === 0)
      found.push({ pool: index, member: null, problem: 'noMembers' });
    const seen = new Set<string>();
    for (const [at, member] of members.entries()) {
      if (member === '') continue;
      if (seen.has(member)) {
        found.push({ pool: index, member: at, problem: 'duplicateMember' });
        continue;
      }
      seen.add(member);
      const format = selectorProblem(member);
      if (format !== null) {
        found.push({ pool: index, member: at, problem: format });
        continue;
      }
      const clashes = pools
        .slice(0, index)
        .some((other) =>
          other.members.some(
            (m) => selectorProblem(m.trim()) === null && selectorsOverlap(m.trim(), member),
          ),
        );
      if (clashes) found.push({ pool: index, member: at, problem: 'overlap' });
    }
  }
  return found;
}

/** An error of the daemon tied to a pool (`pool` is -1 for the section as a whole) and a selector. */
export interface BoundError {
  pool: number;
  member: number | null;
  message: string;
}

/**
 * Ties `swarm.queue.pools.<name>[.max|.members[i]]` to the pool and the selector. The name is the
 * longest name of the draft the path starts with, as a name may contain dots.
 */
export function bindPoolErrors(
  pools: readonly PoolDraft[],
  errors: readonly { path: string; message: string }[],
): BoundError[] {
  const byLength = pools
    .map((pool, index) => ({ name: pool.name.trim(), index }))
    .filter((pool) => pool.name !== '')
    .sort((left, right) => right.name.length - left.name.length);
  return errors
    .filter((error) => /^swarm\.queue\.pools(\.|\[|$)/.test(error.path))
    .map((error) => {
      const rest = error.path.startsWith(POOLS_PREFIX)
        ? error.path.slice(POOLS_PREFIX.length)
        : null;
      const owner =
        rest === null
          ? undefined
          : byLength.find(
              (pool) =>
                rest === pool.name ||
                rest.startsWith(`${pool.name}.`) ||
                rest.startsWith(`${pool.name}[`),
            );
      if (owner === undefined || rest === null) {
        return { pool: -1, member: null, message: `${error.path}: ${error.message}` };
      }
      const member = /^\.members\[(\d+)\]$/.exec(rest.slice(owner.name.length));
      return {
        pool: owner.index,
        member: member ? Number(member[1]) : null,
        message: error.message,
      };
    });
}
