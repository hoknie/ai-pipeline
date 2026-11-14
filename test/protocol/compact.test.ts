import { describe, expect, it } from 'vitest';

import {
  createStyle,
  formatQueue,
  formatRun,
  formatRunList,
  formatUsage,
  plainStyle,
  truncateVisible,
  visibleWidth,
} from '../../src/presentation/format/index.ts';
import { queueView, runView } from '../../src/presentation/ipc/views/index.ts';
import { addItem, emptyQueue } from '../../src/feature/queue/types/index.ts';
import { run } from '../feature/runs/helpers.ts';

const ansi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');
const longTitle = 'Очень длинное название задачи '.repeat(6).trim();

function view(repository: string, title = longTitle) {
  return { ...runView(run(1), 3000), title, repository };
}

describe('createStyle width', () => {
  it('keeps the width only for colored output', () => {
    expect(createStyle(true, 100).columns).toBe(100);
    expect(createStyle(false, 100).columns).toBeNull();
    expect(createStyle(true).columns).toBeNull();
    expect(plainStyle.columns).toBeNull();
  });
});

describe('truncateVisible', () => {
  it('cuts a plain string with an ellipsis', () => {
    expect(truncateVisible('abcdefghij', 5)).toBe('abcd…');
  });

  it('leaves a short string alone', () => {
    expect(truncateVisible('abc', 5)).toBe('abc');
    expect(truncateVisible('abcde', 5)).toBe('abcde');
  });

  it('resets the style after the ellipsis', () => {
    const style = createStyle(true);
    const text = `${style.danger('abcdefghij')}`;
    const cut = truncateVisible(text, 4);
    expect(visibleWidth(cut)).toBe(4);
    expect(ansi(cut)).toBe('abc…');
    expect(cut.endsWith('…\x1b[0m')).toBe(true);
  });

  it('keeps the colors of the part before the cut', () => {
    const style = createStyle(true);
    const text = `${style.muted('ab')} ${style.accent('cdefghij')}`;
    const cut = truncateVisible(text, 6);
    expect(ansi(cut)).toBe('ab cd…');
    expect(cut).toContain(style.muted('ab'));
  });

  it('counts a state badge as one column', () => {
    expect(truncateVisible('✓ merged', 4)).toBe('✓ m…');
  });
});

describe('run list in a terminal', () => {
  it('fits the width and cuts TITLE with an ellipsis', () => {
    const style = createStyle(true, 100);
    const text = formatRunList([view('/a')], style);
    for (const line of text.split('\n')) expect(visibleWidth(line)).toBeLessThanOrEqual(100);
    expect(ansi(text.split('\n')[1]!)).toContain('…');
  });

  it('is unchanged without color or without a width', () => {
    const usage = { inputTokens: 92519, outputTokens: 77, costUsd: 0.0123 };
    const withUsage = { ...view('/a'), usage } as ReturnType<typeof view>;
    const full = formatRunList([withUsage], plainStyle);
    expect(full).toContain(longTitle.slice(0, 47));
    expect(full).toContain('92519 in / 77 out · $0.0123');
    // colored but without a width: nothing is cut, usage is full, the project column stays
    const colored = ansi(formatRunList([withUsage], createStyle(true)));
    expect(colored).toContain('REPOSITORY');
    expect(colored).toContain(longTitle.slice(0, 47));
    expect(colored).toContain('92519 in / 77 out · $0.0123');
    const tail = (line: string) => line.slice(line.indexOf('Очень'));
    expect(tail(colored.split('\n')[1]!)).toBe(tail(full.split('\n')[1]!));
  });

  it('cuts only the flexible column, the others stay', () => {
    const usage = { inputTokens: 92519, outputTokens: 77, costUsd: 0.0123 };
    const rows = [
      { ...view('/a'), usage },
      { ...view('/b', 'y'), id: 'run000000002', usage },
    ] as ReturnType<typeof view>[];
    const text = ansi(formatRunList(rows, createStyle(true, 120)));
    const first = text.split('\n')[1]!;
    expect(first).toContain('…');
    expect(first).toContain('92.5k in / 77 out · $0.01');
    expect(first).toContain('/a');
  });

  it('hides REPOSITORY with one project only in a terminal', () => {
    const one = [view('/a', 'x'), { ...view('/a', 'y'), id: 'run000000002' }];
    const two = [view('/a', 'x'), { ...view('/b', 'y'), id: 'run000000002' }];
    const style = createStyle(true, 200);
    expect(formatRunList(one, style)).not.toContain('REPOSITORY');
    expect(formatRunList(two, style)).toContain('REPOSITORY');
    expect(formatRunList(one, plainStyle)).toContain('REPOSITORY');
  });

  it('cuts NOTE of a group table to the width', () => {
    const state = run(1);
    state.groups[0]!.status = 'failed';
    state.groups[0]!.reason = 'причина '.repeat(30);
    const text = formatRun(runView(state, 3000), 3000, createStyle(true, 90));
    const row = ansi(text)
      .split('\n')
      .find((line) => line.includes('причина'))!;
    expect(row.length).toBeLessThanOrEqual(90);
    expect(row).toContain('…');
  });
});

describe('short usage', () => {
  const usage = { inputTokens: 92519, outputTokens: 77, costUsd: 0.0123 } as Parameters<
    typeof formatUsage
  >[0];

  it('is full without a width and short in a terminal', () => {
    expect(formatUsage(usage)).toBe('92519 in / 77 out · $0.0123');
    expect(formatUsage(usage, createStyle(true))).toBe('92519 in / 77 out · $0.0123');
    expect(formatUsage(usage, createStyle(true, 120))).toBe('92.5k in / 77 out · $0.01');
    expect(formatUsage(null, createStyle(true, 120))).toBe('—');
  });
});

describe('queue line in a terminal', () => {
  function build() {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'я'.repeat(120) }, 'q1', 1000);
    return queueView(queue, () => undefined);
  }

  it('cuts the task text to the width', () => {
    const text = formatQueue(build(), createStyle(true, 80));
    const line = ansi(text.split('\n').find((row) => row.startsWith('  1.'))!);
    expect(line.length).toBeLessThanOrEqual(80);
    expect(line).toContain('#1');
    expect(line).toContain('q1');
    expect(line).toContain('feature');
    expect(line).toContain('…');
  });

  it('keeps the whole text without a width', () => {
    const full = `${'я'.repeat(79)}…`;
    expect(formatQueue(build())).toContain(`  ${full}  added`);
    expect(formatQueue(build(), createStyle(true))).toContain(`  ${full}  added`);
  });
});
