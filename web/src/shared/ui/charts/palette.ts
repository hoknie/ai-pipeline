import { PROJECT_DOT_CLASSES } from '../feedback/ProjectDot.tsx';

/** Count of colors of the fallback palette: `--color-chart-1` … `--color-chart-8` of the theme. */
export const FALLBACK_COUNT = 8;

/** The colors of the theme for series without a color of their own, in the order they are given. */
export const FALLBACK_COLORS: readonly string[] = Array.from(
  { length: FALLBACK_COUNT },
  (_, index) => `var(--color-chart-${index + 1})`,
);

/** The color of the part «Other» and of whatever has no meaning of its own. */
export const NEUTRAL_COLOR = 'var(--color-status-mute)';

/** The colors of the task outcomes, from the status tokens of the theme. */
export const OUTCOME_COLORS = {
  finished: 'var(--color-status-ok)',
  failed: 'var(--color-status-err)',
  cancelled: 'var(--color-status-mute)',
} as const;

/** The shade of a project color of the registry (`blue`), or null for an unknown name. */
export function projectShade(color: string | null): string | null {
  if (color === null) return null;
  const match = /#[0-9a-f]{6}/i.exec(PROJECT_DOT_CLASSES[color] ?? '');
  return match?.[0] ?? null;
}

/**
 * The color of every key: the color of the project when it has one, else the next color of the
 * fallback palette in the order of `keys` (the same input gives the same colors).
 */
export function assignColors(
  keys: readonly string[],
  colorOf: (key: string) => string | null,
): Record<string, string> {
  const colors: Record<string, string> = {};
  let next = 0;
  for (const key of keys) {
    const own = projectShade(colorOf(key));
    if (own !== null) {
      colors[key] = own;
      continue;
    }
    colors[key] = FALLBACK_COLORS[next % FALLBACK_COUNT] ?? NEUTRAL_COLOR;
    next += 1;
  }
  return colors;
}
