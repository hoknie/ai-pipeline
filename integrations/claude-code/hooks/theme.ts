import type { AipConnection, AipDeliveryState, AipGroupStatus } from '../types';

/** Theme keys the mod may use; colours are never literal values. */
export const THEME_KEYS = [
  'inactive',
  'subtle',
  'suggestion',
  'warning',
  'merged',
  'error',
  'success',
] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

export type StatusStyle = { icon: string; label: string; color: ThemeKey };

export const STATUS: Readonly<Record<AipGroupStatus, StatusStyle>> = {
  queued: { icon: '○', label: 'queued', color: 'inactive' },
  waiting: { icon: '◷', label: 'waiting', color: 'inactive' },
  running: { icon: '◐', label: 'running', color: 'suggestion' },
  needs_human: { icon: '?', label: 'needs you', color: 'warning' },
  merging: { icon: '⇄', label: 'merging', color: 'suggestion' },
  merged: { icon: '●', label: 'merged', color: 'merged' },
  conflict: { icon: '⚠', label: 'conflict', color: 'warning' },
  failed: { icon: '✕', label: 'failed', color: 'error' },
  cancelled: { icon: '⊘', label: 'cancelled', color: 'inactive' },
};

export const DELIVERY: Readonly<Record<AipDeliveryState, StatusStyle>> = {
  pending: { icon: '○', label: 'not applied', color: 'inactive' },
  applied: { icon: '✓', label: 'applied', color: 'success' },
  apply_failed: { icon: '✕', label: 'apply failed', color: 'error' },
};

/** The state of the link to aip, drawn in the header of the pane. */
export const CONNECTION: Readonly<Record<AipConnection['mode'], StatusStyle>> = {
  stream: { icon: '●', label: 'live', color: 'success' },
  polling: { icon: '◌', label: 'polling', color: 'warning' },
  connecting: { icon: '◌', label: 'connecting', color: 'inactive' },
  missing: { icon: '✕', label: 'offline', color: 'error' },
};

/** The outcome of the last action: one symbol and one colour. */
export const RESULT: Readonly<Record<'ok' | 'error', { icon: string; color: ThemeKey }>> = {
  ok: { icon: '✓', color: 'success' },
  error: { icon: '✕', color: 'error' },
};

/** Colour of the frames around what waits for the user. */
export const ATTENTION_COLOR: ThemeKey = 'warning';

/** Mark in front of the selected run in the list. */
export const SELECTED_MARK = '›';

export function progressBar(done: number, total: number, cells = 10): string {
  if (total <= 0) return '▱'.repeat(cells);
  const filled = Math.max(0, Math.min(cells, Math.round((done / total) * cells)));
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled);
}
