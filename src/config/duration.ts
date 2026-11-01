const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600 };

export function parseDuration(value: string): number | null {
  const match = /^(\d+)([smh])$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const seconds = amount * (UNITS[match[2] ?? ''] ?? 0);
  return amount > 0 && Number.isSafeInteger(seconds) ? seconds : null;
}

export function formatDuration(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}
