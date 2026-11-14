/** Settings whose presence in Claude's --settings could bypass aip's policy. */
export const CLAUDE_RESERVED_KEYS = [
  'permissions',
  'hooks',
  'enableAllProjectMcpServers',
  'enabledMcpjsonServers',
  'disabledMcpjsonServers',
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Merge generated settings over user settings, replacing owned nodes entirely. */
export function overlay(
  base: Record<string, unknown>,
  top: Record<string, unknown>,
  owned: readonly (readonly string[])[],
): Record<string, unknown> {
  function merge(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
    path: string[],
  ): Record<string, unknown> {
    const result = { ...left };
    for (const [key, value] of Object.entries(right)) {
      const next = [...path, key];
      const replace = owned.some(
        (item) => item.length === next.length && item.every((part, i) => part === next[i]),
      );
      const previous = Object.hasOwn(left, key) ? left[key] : undefined;
      Object.defineProperty(result, key, {
        value:
          !replace && isObject(previous) && isObject(value) ? merge(previous, value, next) : value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  }
  return merge(base, top, []);
}
