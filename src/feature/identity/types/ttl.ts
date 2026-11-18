const UNITS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Milliseconds of `<n>m`, `<n>h` or `<n>d`; `null` for any other text. */
export function parseTtl(text: string): number | null {
  const match = /^([1-9]\d*)([mhd])$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * (UNITS[match[2] ?? ''] ?? 0);
}

export const MINUTE = 60_000;
export const DAY = 86_400_000;
export const LOGIN_LINK_DEFAULT_TTL = 15 * MINUTE;
export const LOGIN_LINK_MAX_TTL = 7 * DAY;
export const CLI_CODE_TTL = 60_000;
export const SESSION_CACHE_MS = 10_000;
