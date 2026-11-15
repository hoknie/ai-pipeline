import type { RunView } from '../ipc/contract/index.ts';
import { type Style, isTerminal, plainStyle } from './style.ts';

/** `950`, `12.5k`, `3.2M`. */
export function formatTokens(value: number): string {
  const short = (amount: number, suffix: string): string =>
    `${amount.toFixed(1).replace(/\.0$/, '')}${suffix}`;
  if (value >= 1_000_000) return short(value / 1_000_000, 'M');
  if (value >= 1000) return short(value / 1000, 'k');
  return String(Math.round(value));
}

/** Usage of a run, group or attempt; short (`92.5k in / 77 out`) in a terminal. */
export function formatUsage(usage: RunView['usage'], style: Style = plainStyle): string {
  if (!usage) return '—';
  if (isTerminal(style)) {
    return `${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out`;
  }
  return `${usage.inputTokens} in / ${usage.outputTokens} out`;
}
