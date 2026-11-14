import { describe, expect, it } from 'vitest';

import {
  activityLines,
  createStyle,
  hintCommand,
  hintLine,
  plainStyle,
  progressBar,
  progressLine,
  runHints,
  stepsLine,
  formatRun,
} from '../../src/presentation/format/index.ts';
import type { RunView } from '../../src/presentation/ipc/contract/index.ts';
import { runView } from '../../src/presentation/ipc/views/index.ts';
import { run } from '../feature/runs/helpers.ts';

const rich = createStyle(true);
// eslint-disable-next-line no-control-regex
const strip = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

function view(patch: Partial<RunView> = {}): RunView {
  return { ...runView(run(1), 1000), ...patch };
}

const steps: RunView['steps'] = [
  { id: 'plan', specialist: 'p', name: 'План', skipped: false, state: 'done' },
  { id: 'code', specialist: 'c', name: 'Код', skipped: false, state: 'active' },
  { id: 'review', specialist: 'r', name: 'Ревью', skipped: false, state: 'upcoming' },
  { id: 'qa', specialist: 'q', name: 'Тесты', skipped: true, state: 'upcoming' },
];

describe('stepsLine', () => {
  const run4 = view({ steps, progress: { done: 1, total: 4 } });

  it('marks the states with words without color', () => {
    expect(stepsLine(run4, plainStyle)).toBe(
      'Steps: План [done] → Код [active] → Ревью → Тесты [skipped]',
    );
  });

  it('marks the states with badges in color', () => {
    const line = stepsLine(run4, rich) ?? '';
    expect(strip(line)).toBe('Steps: План ✓ → Код ▸ → Ревью ◦ → Тесты ⊘');
    expect(line).toContain(rich.success('✓'));
  });

  it('puts the skip mark over the others', () => {
    const skippedDone = view({
      steps: [{ ...steps[0]!, skipped: true }],
      progress: { done: 0, total: 1 },
    });
    expect(stepsLine(skippedDone, plainStyle)).toBe('Steps: План [skipped]');
  });

  it('gives nothing while the task is split', () => {
    const splitting = view({ steps, progress: { done: 0, total: 0 } });
    expect(stepsLine(splitting, plainStyle)).toBeNull();
    expect(progressLine(splitting, plainStyle)).toBeNull();
    expect(progressLine(splitting, rich)).toBeNull();
  });
});

describe('progress', () => {
  it('draws the bar rounded down', () => {
    expect(strip(progressBar(0, 10, rich))).toBe('░░░░░░░░░░');
    expect(strip(progressBar(5, 10, rich))).toBe('█████░░░░░');
    expect(strip(progressBar(10, 10, rich))).toBe('██████████');
    expect(strip(progressBar(1, 3, rich))).toBe('███░░░░░░░');
  });

  it('prints the bar only in color', () => {
    const half = view({ progress: { done: 5, total: 10 }, steps });
    expect(progressLine(half, plainStyle)).toBe('Progress: 5/10 steps');
    expect(strip(progressLine(half, rich) ?? '')).toBe('Progress: █████░░░░░ 5/10 steps');
  });

  it('adds the working changes of an unfinished run only', () => {
    const live = { files: 4, added: 120, removed: 8 };
    const working = view({ progress: { done: 3, total: 7 }, liveDiff: live, finished: false });
    expect(progressLine(working, plainStyle)).toBe(
      'Progress: 3/7 steps · working changes 4 files +120 −8',
    );
    const finished = view({ progress: { done: 6, total: 6 }, liveDiff: live, finished: true });
    expect(progressLine(finished, plainStyle)).toBe('Progress: 6/6 steps');
    const unknown = view({ progress: { done: 3, total: 7 }, liveDiff: null, finished: false });
    expect(progressLine(unknown, plainStyle)).toBe('Progress: 3/7 steps');
  });
});

describe('activityLines', () => {
  it('prints one line per group', () => {
    const lines = activityLines(new Map([['login', 'Editing src/login.ts']]), plainStyle);
    expect(lines).toEqual(['login: Editing src/login.ts']);
    expect(strip(activityLines(new Map([['login', 'x']]), rich)[0] ?? '')).toBe('login: x');
  });

  it('cuts a long line to 120 characters with an ellipsis', () => {
    const [line] = activityLines(new Map([['login', `a\n${'b'.repeat(300)}`]]), plainStyle);
    expect(line).not.toContain('\n');
    expect(line?.length).toBe(120);
    expect(line?.endsWith('…')).toBe(true);
  });

  it('skips empty lines', () => {
    expect(activityLines(new Map([['login', '  ']]), plainStyle)).toEqual([]);
  });
});

describe('hints', () => {
  it('spells the commands', () => {
    expect(hintCommand({ kind: 'answer', runId: 'r1', group: 'login' })).toBe(
      'aip group answer r1 login "<answer>"',
    );
    expect(hintCommand({ kind: 'retry', runId: 'r1', group: 'login' })).toBe(
      'aip group retry r1 login',
    );
    expect(hintCommand({ kind: 'apply', runId: 'r1' })).toBe('aip run apply r1');
    expect(hintCommand({ kind: 'queue_start', repository: 'repo' })).toBe(
      'aip queue start --repo repo',
    );
    expect(strip(hintLine({ kind: 'apply', runId: 'r1' }, rich))).toBe('→ aip run apply r1');
  });

  function withGroups(statuses: string[], patch: Partial<RunView> = {}): RunView {
    const base = view(patch);
    const groups = statuses.map((status, index) => ({
      ...base.groups[0]!,
      slug: `g${index}`,
      status: status as RunView['groups'][number]['status'],
    }));
    return { ...base, groups };
  }

  it('suggests an answer, a retry and a delivery', () => {
    const delivery = { applied: 0, merged: 1, failed: 0, inProgress: false, finishedAt: null };
    const text = runHints(
      withGroups(['needs_human', 'failed', 'conflict'], { autoDeliver: false, delivery }),
      rich,
    ).map(strip);
    expect(text).toEqual([
      `→ aip group answer ${view().id} g0 "<answer>"`,
      `→ aip group retry ${view().id} g1`,
      `→ aip group retry ${view().id} g2`,
      `→ aip run apply ${view().id}`,
    ]);
  });

  it('does not suggest delivery while it runs or for automatic delivery', () => {
    const busy = { applied: 0, merged: 1, failed: 0, inProgress: true, finishedAt: null };
    expect(runHints(withGroups(['merged'], { autoDeliver: false, delivery: busy }), rich)).toEqual(
      [],
    );
    const idle = { ...busy, inProgress: false };
    expect(runHints(withGroups(['merged'], { autoDeliver: true, delivery: idle }), rich)).toEqual(
      [],
    );
  });

  it('is empty without color', () => {
    expect(runHints(withGroups(['needs_human', 'failed']), plainStyle)).toEqual([]);
  });

  it('puts activity above the hints and ends with a hint', () => {
    const text = formatRun(withGroups(['running', 'needs_human']), 2000, rich, ['login: Editing']);
    const lines = strip(text).split('\n');
    const activity = lines.indexOf('login: Editing');
    const hint = lines.findIndex((line) => line.startsWith('→ '));
    expect(activity).toBeGreaterThan(0);
    expect(hint).toBeGreaterThan(activity);
    expect(lines.at(-1)).toMatch(/^→ /);
    expect(lines[activity + 1]).toBe('');
  });

  it('prints the same text without activity as before the fourth argument', () => {
    const v = withGroups(['running']);
    expect(formatRun(v, 2000, plainStyle, [])).toBe(formatRun(v, 2000, plainStyle));
  });
});

describe('formatRun with the new lines', () => {
  it('matches the old text once Steps: and Progress: are removed', () => {
    const v = view({ steps, progress: { done: 1, total: 4 } });
    const text = formatRun(v, 2000);
    expect(text).toContain('Steps: ');
    const without = text
      .split('\n')
      .filter((line) => !line.startsWith('Steps:') && !line.startsWith('Progress:'))
      .join('\n');
    const bare = formatRun({ ...v, progress: { done: 0, total: 0 } }, 2000);
    expect(without).toBe(bare);
  });
});
