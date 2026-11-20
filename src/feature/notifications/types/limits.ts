/** How much of every kind of text a message may carry before the channel shortens it further. */
export interface RenderLimits {
  /** A question, a reason or a summary. */
  text: number;
  /** One option or one answer. */
  option: number;
  /** A line of the details. */
  detail: number;
}

export const DEFAULT_LIMITS: RenderLimits = { text: 900, option: 300, detail: 120 };

const FLOOR: RenderLimits = { text: 60, option: 30, detail: 20 };

/** The next, tighter limits; null when nothing is left to cut. */
export function tighten(limits: RenderLimits): RenderLimits | null {
  const next: RenderLimits = {
    text: Math.max(FLOOR.text, Math.floor(limits.text / 2)),
    option: Math.max(FLOOR.option, Math.floor(limits.option / 2)),
    detail: Math.max(FLOOR.detail, Math.floor(limits.detail / 2)),
  };
  return next.text === limits.text && next.option === limits.option && next.detail === limits.detail
    ? null
    : next;
}

/** Cuts the text to `max` characters (code points) with an ellipsis; the cut is reported. */
export function truncate(text: string, max: number): { text: string; cut: boolean } {
  const chars = [...text];
  if (chars.length <= max) return { text, cut: false };
  return {
    text: `${chars
      .slice(0, Math.max(max - 1, 1))
      .join('')
      .trimEnd()}…`,
    cut: true,
  };
}

/** The text without absolute paths: the root of the project becomes `.`, other paths their last segment. */
export function withoutPaths(text: string, root: string): string {
  const stripped = root === '' ? text : text.split(root).join('.');
  return stripped.replace(/(?<![\w.:/-])\/(?:[\w.@+-]+\/)+([\w.@+-]+)/g, '$1');
}
