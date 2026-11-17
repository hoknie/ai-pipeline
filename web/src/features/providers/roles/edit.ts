/** The `roles` of one settings file: slug → `{ name }`, in the order of the file. */
export type RoleRecord = Record<string, Record<string, unknown> & { name: string }>;

type Level = 'global' | 'project';

/** The roles of a level as the settings file has them: ordered, each with a name. */
export function roleRecordOf(written: unknown): RoleRecord {
  if (typeof written !== 'object' || written === null || Array.isArray(written)) return {};
  return Object.fromEntries(
    Object.entries(written).map(([slug, value]) => {
      const raw = typeof value === 'object' && value !== null ? value : {};
      const name = (raw as { name?: unknown }).name;
      return [slug, { ...raw, name: typeof name === 'string' ? name : slug }];
    }),
  ) as RoleRecord;
}

/** The role appended to the end of the level. */
export const addRole = (roles: RoleRecord, slug: string, name: string): RoleRecord => ({
  ...roles,
  [slug]: { name },
});

/** The role with a new name; its slug and other keys stay. A role the level lacks is added. */
export const renameRole = (roles: RoleRecord, slug: string, name: string): RoleRecord => ({
  ...roles,
  [slug]: { ...roles[slug], name },
});

export function removeRole(roles: RoleRecord, slug: string): RoleRecord {
  const { [slug]: _removed, ...rest } = roles;
  return rest;
}

/**
 * The slugs of a level that may change places: all of the shared level; at the project level only
 * the roles the shared level does not have, because the others stand where the shared level put them.
 */
export function movableRoles(level: Level, own: RoleRecord, shared: RoleRecord): string[] {
  return Object.keys(own).filter((slug) => level === 'global' || !(slug in shared));
}

function neighbour(movable: readonly string[], slug: string, step: -1 | 1): string | null {
  const index = movable.indexOf(slug);
  if (index < 0) return null;
  return movable[index + step] ?? null;
}

export const canMove = (movable: readonly string[], slug: string, step: -1 | 1): boolean =>
  neighbour(movable, slug, step) !== null;

/** The role swapped with its neighbour among the movable ones; unchanged when there is none. */
export function moveRole(
  roles: RoleRecord,
  movable: readonly string[],
  slug: string,
  step: -1 | 1,
): RoleRecord {
  const other = neighbour(movable, slug, step);
  if (other === null) return roles;
  const order = Object.keys(roles);
  const a = order.indexOf(slug);
  const b = order.indexOf(other);
  [order[a], order[b]] = [order[b]!, order[a]!];
  return Object.fromEntries(order.map((key) => [key, roles[key]!])) as RoleRecord;
}
