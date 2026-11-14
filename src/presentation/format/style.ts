import { styleText } from 'node:util';

export interface ColorInput {
  /** `--no-color` was passed. */
  noColorFlag: boolean;
  env: Record<string, string | undefined>;
  isTTY: boolean;
}

/**
 * Decides whether output is colored: `--no-color` beats `NO_COLOR`, which beats
 * `FORCE_COLOR`, which beats the terminal check (`TERM=dumb` is never colored).
 */
export function colorEnabled({ noColorFlag, env, isTTY }: ColorInput): boolean {
  if (noColorFlag) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  const force = env.FORCE_COLOR;
  if (force !== undefined) return force !== '0' && force !== 'false';
  return isTTY && env.TERM !== 'dumb';
}

export interface Style {
  /** Colored output: badges, bars and hints are drawn only when true. */
  readonly rich: boolean;
  /** Terminal width fixed at the start of the command; null outside a terminal or when unknown. */
  readonly columns: number | null;
  title(text: string): string;
  command(text: string): string;
  option(text: string): string;
  argument(text: string): string;
  muted(text: string): string;
  accent(text: string): string;
  success(text: string): string;
  warning(text: string): string;
  danger(text: string): string;
}

const identity = (text: string): string => text;

export const plainStyle: Style = {
  rich: false,
  columns: null,
  title: identity,
  command: identity,
  option: identity,
  argument: identity,
  muted: identity,
  accent: identity,
  success: identity,
  warning: identity,
  danger: identity,
};

export function createStyle(enabled: boolean, columns?: number): Style {
  if (!enabled) return plainStyle;
  const paint =
    (format: Parameters<typeof styleText>[0]) =>
    (text: string): string =>
      styleText(format, text, { validateStream: false });
  return {
    rich: true,
    columns: columns !== undefined && columns > 0 ? columns : null,
    title: paint('bold'),
    command: paint('cyan'),
    option: paint('green'),
    argument: paint('yellow'),
    muted: paint('dim'),
    accent: paint('magenta'),
    success: paint('green'),
    warning: paint('yellow'),
    danger: paint('red'),
  };
}

type StyleRole = 'success' | 'danger' | 'warning' | 'command' | 'muted';

/** Badge and color role of each state word; each badge is one column wide. */
export const STATUS_BADGES: Readonly<Record<string, { badge: string; role: StyleRole }>> = {
  merged: { badge: '✓', role: 'success' },
  finished: { badge: '✓', role: 'success' },
  applied: { badge: '✓', role: 'success' },
  done: { badge: '✓', role: 'success' },
  failed: { badge: '✗', role: 'danger' },
  conflict: { badge: '✗', role: 'danger' },
  apply_failed: { badge: '✗', role: 'danger' },
  rejected: { badge: '✗', role: 'danger' },
  needs_human: { badge: '?', role: 'warning' },
  running: { badge: '▸', role: 'command' },
  active: { badge: '▸', role: 'command' },
  merging: { badge: '▸', role: 'command' },
  queued: { badge: '◦', role: 'muted' },
  waiting: { badge: '◷', role: 'muted' },
  paused: { badge: '◦', role: 'warning' },
  frozen: { badge: '◦', role: 'warning' },
  repair: { badge: '▸', role: 'command' },
  pending: { badge: '◦', role: 'muted' },
  stopped: { badge: '◦', role: 'muted' },
  cancelled: { badge: '⊘', role: 'muted' },
};

/** A state word with its badge and color; unchanged without color or for an unknown state. */
export function statusBadge(status: string, style: Style): string {
  if (!style.rich) return status;
  const entry = Object.hasOwn(STATUS_BADGES, status) ? STATUS_BADGES[status] : undefined;
  if (!entry) return status;
  return style[entry.role](`${entry.badge} ${status}`);
}

/** Width of the text on screen: SGR escape sequences take no columns. */
export function visibleWidth(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/** Color and a known width: the output is shaped for a terminal window. */
export function isTerminal(style: Style): style is Style & { columns: number } {
  return style.rich && style.columns !== null;
}

/**
 * Cuts the text to `width` visible columns, ending with `…`. SGR sequences take no columns; the
 * style is reset after `…` when the cut part left one open.
 */
export function truncateVisible(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text;
  const keep = Math.max(0, width - 1);
  let out = '';
  let shown = 0;
  let open = false;
  // eslint-disable-next-line no-control-regex
  for (const part of text.split(/(\x1b\[[0-9;]*m)/)) {
    // eslint-disable-next-line no-control-regex
    if (/^\x1b\[[0-9;]*m$/.test(part)) {
      const reset = part === '\x1b[0m' || part === '\x1b[m';
      if (reset || shown < keep) {
        out += part;
        open = !reset;
      }
      continue;
    }
    if (shown >= keep) continue;
    const take = part.slice(0, keep - shown);
    out += take;
    shown += take.length;
  }
  return `${out}…${open ? '\x1b[0m' : ''}`;
}
