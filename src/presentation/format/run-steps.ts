import { formatDiff } from './groups.ts';
import type { Style } from './style.ts';
import type { RunView } from '../ipc/contract/index.ts';

const BAR_WIDTH = 10;
export const ACTIVITY_WIDTH = 120;

type Step = RunView['steps'][number];

function stepMark(step: Step, style: Style): string {
  if (style.rich) {
    if (step.skipped) return ` ${style.muted('⊘')}`;
    if (step.state === 'done') return ` ${style.success('✓')}`;
    if (step.state === 'active') return ` ${style.command('▸')}`;
    return ` ${style.muted('◦')}`;
  }
  if (step.skipped) return ' [skipped]';
  if (step.state === 'done') return ' [done]';
  if (step.state === 'active') return ' [active]';
  return '';
}

/** `Steps:` line of a run; null while the task is split (no work-group steps yet). */
export function stepsLine(run: RunView, style: Style): string | null {
  if (run.progress.total === 0 || run.steps.length === 0) return null;
  const chain = run.steps.map((step) => `${step.name}${stepMark(step, style)}`).join(' → ');
  return `${style.muted('Steps:')} ${chain}`;
}

/** Ten-character bar: the share of passed steps rounded down is `█`, the rest `░`. */
export function progressBar(done: number, total: number, style: Style): string {
  const filled = total <= 0 ? 0 : Math.min(BAR_WIDTH, Math.floor((done / total) * BAR_WIDTH));
  return `${'█'.repeat(filled)}${style.muted('░'.repeat(BAR_WIDTH - filled))}`;
}

/** `Progress:` line of a run; null while the task is split. */
export function progressLine(run: RunView, style: Style): string | null {
  const { done, total } = run.progress;
  if (total === 0) return null;
  const bar = style.rich ? `${progressBar(done, total, style)} ` : '';
  const live =
    !run.finished && run.liveDiff ? ` · working changes ${formatDiff(run.liveDiff, style)}` : '';
  return `${style.muted('Progress:')} ${bar}${done}/${total} steps${live}`;
}

/** One line per running group: `<group>: <last log line>`, at most 120 characters. */
export function activityLines(lines: ReadonlyMap<string, string>, style: Style): string[] {
  const result: string[] = [];
  for (const [slug, raw] of lines) {
    const flat = raw.replace(/\s+/g, ' ').trim();
    if (flat === '') continue;
    const room = Math.max(1, ACTIVITY_WIDTH - slug.length - 2);
    const text = flat.length > room ? `${flat.slice(0, room - 1)}…` : flat;
    result.push(`${style.accent(slug)}: ${style.muted(text)}`);
  }
  return result;
}
