import { describe, expect, it } from 'vitest';

import {
  createStyle,
  filterByTags,
  formatTagLabels,
  formatTagList,
  formatGroup,
  formatQueue,
  formatRepositories,
  formatRun,
  formatRunList,
  formatRunQueued,
  groupView,
  queueView,
  runView,
  waitNote,
  workflowLabel,
} from '../../src/protocol/index.ts';
import {
  addItem,
  emptyQueue,
  itemStarted,
  transition,
  type GroupWait,
} from '../../src/core/index.ts';
import { CONFIG_TEXT, finish, group, run, step } from '../core/helpers.ts';

describe('text for people', () => {
  it('shows the run header, counts and one line per group', () => {
    const state = run(2);
    step(state, 1000);
    finish(state, 'needs_human', { feedback: 'OAuth или пароль?\nподробности', now: 61_000 });
    expect(formatRun(runView(state, 121_000), 121_000)).toBe(
      [
        'Run #1 run000000001 · feature · needs_human · refs/aip/run000000001/run',
        'Title: Группа 1, Группа 2',
        'Repository: /repo',
        'Groups: running 1 · needs_human 1 (2) · usage — · started 2m00s ago',
        '',
        'GROUP     STATUS       STEP         ROUND  TIME   CHANGES  DELIVERY  NOTE',
        'gruppa-1  needs_human  Планировщик  1      1m00s  —        —         question: OAuth или пароль?',
        'gruppa-2  running      Планировщик  1      2m00s  —        —',
      ].join('\n'),
    );
  });

  it('shows the resolver round and conflicting files of a delivery', () => {
    const state = run(1, {
      configText: `${CONFIG_TEXT}  delivery: { auto: false, resolver: coder, resolver_rounds: 2 }\n`,
    });
    for (const _ of ['plan', 'code', 'review', 'qa']) {
      step(state);
      finish(state, 'done');
    }
    transition(
      state,
      { kind: 'merge_finished', group: 'gruppa-1', outcome: { kind: 'merged', commit: 'c' } },
      5000,
    );
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 6000);
    const result = { kind: 'refused' as const, reason: 'x', files: ['lib.ts'], conflict: true };
    transition(state, { kind: 'delivery_finished', result }, 6100);
    transition(state, { kind: 'resolve_prepared', conflicts: ['lib.ts'] }, 6200);
    expect(formatRun(runView(state, 7000), 7000)).toContain(
      'Resolver: queued (round 1/2; conflicts: lib.ts)',
    );
    expect(runView(state, 7000).resolver).toMatchObject({ status: 'queued', round: 1, rounds: 2 });
  });

  it('lists every attempt with its verdict, summary and feedback', () => {
    const state = run(1);
    step(state, 1000);
    finish(state, 'done', { summary: 'план готов', now: 4000 });
    state.groups[0]!.attempts[0]!.usage = { inputTokens: 10, outputTokens: 2, costUsd: 0.5 };
    const text = formatGroup(
      groupView(state, state.groups[0]!, '/w/gruppa-1', { seq: 1, lines: ['line'] }, 5000),
    );
    expect(text).toContain('Group gruppa-1 (Группа 1) · queued · run run000000001');
    expect(text).toContain('Ref: refs/aip/run000000001/groups/gruppa-1');
    expect(text).toContain(
      '#1 Планировщик r1 · plan (claude) · finished done · 3s · 10 in / 2 out · $0.5000',
    );
    expect(text).toContain('summary: план готов');
    expect(text).toContain('Log of attempt #1:\n  line');
  });

  it('lists refused calls under the attempt and hints the patterns once per group', () => {
    const state = run(1);
    step(state, 1000);
    finish(state, 'needs_human', { feedback: 'запустите тесты', now: 4000 });
    state.groups[0]!.attempts[0]!.denials = [
      { tool: 'Bash', command: 'claude plugin test a' },
      { tool: 'Bash', command: 'cd w && claude plugin test b' },
      { tool: 'Bash', command: "python3 - <<'EOF'\nprint(1)\nEOF" },
      { tool: 'Write', command: null },
    ];
    const view = () => groupView(state, state.groups[0]!, '/w', null, 5000);
    const text = formatGroup(view());
    expect(text).toContain('     denied: Bash claude plugin test a → claude plugin *');
    expect(text).toContain('     denied: Bash cd w && claude plugin test b → claude plugin *');
    expect(text).toContain(
      "     denied: Bash python3 - <<'EOF' ⏎ print(1) ⏎ EOF → no pattern allows it",
    );
    expect(text).toMatch(/^ {5}denied: Write$/m);
    expect(text).toContain(
      "Permission hints: add to allow_commands: 'claude plugin *' (a retry or an answer picks them up)",
    );
    state.run.config.specialists.find((specialist) => specialist.slug === 'plan')!.allowCommands = [
      'claude plugin *',
    ];
    expect(view().permissionHints).toEqual([]);
    expect(formatGroup(view())).not.toContain('Permission hints');
    expect(formatGroup(view())).toMatch(/^ {5}denied: Bash claude plugin test a$/m);
  });

  it('shows a run waiting for an answer as needs_human with the waiting count', () => {
    const state = run(3);
    state.groups[0]!.status = 'needs_human';
    state.groups[1]!.status = 'needs_human';
    state.groups[2]!.status = 'running';
    const view = runView(state, 2000);
    expect(view).toMatchObject({ state: 'needs_human', waiting: 2, finished: false });
    expect(JSON.parse(JSON.stringify(view))).toMatchObject({ state: 'needs_human', waiting: 2 });
    expect(formatRun(view, 2000)).toContain(' · needs_human · ');
    expect(formatRunList([view])).toContain('needs_human');
  });

  it('prints files changed outside the worktree as a warning and counts them in the row', () => {
    const state = run(1);
    step(state, 1000);
    state.groups[0]!.attempts[0]!.outsideChanges = ['README.md', 'docs/a.md'];
    const view = groupView(state, state.groups[0]!, '/w', null, 2000);
    expect(view.warnings).toEqual([]);
    expect(view.attempts[0]?.outsideChanges).toEqual(['README.md', 'docs/a.md']);
    expect(formatGroup(view)).toContain(
      'Warning: files in the working copy changed during step Планировщик: README.md, docs/a.md',
    );
    expect(runView(state, 2000).groups[0]?.warnings).toBe(1);
    state.groups[0]!.warnings.push('other');
    expect(runView(state, 2000).groups[0]?.warnings).toBe(2);
  });

  it('turns outside-change warnings of older runs into the files of their attempts', () => {
    const state = run(1);
    step(state, 1000);
    finish(state, 'done', { now: 2000 });
    step(state, 2100);
    finish(state, 'done', { now: 3000 });
    const group = state.groups[0]!;
    group.warnings = [
      'step plan changed files outside its worktree: swarm.yaml, README.md',
      'step lint changed files outside its worktree: a.ts',
      'something else',
    ];
    const view = groupView(state, group, '/w', null, 4000);
    expect(view.attempts[0]?.outsideChanges).toEqual(['swarm.yaml', 'README.md']);
    expect(view.attempts[1]?.outsideChanges).toEqual([]);
    expect(view.warnings).toEqual([
      'step lint changed files outside its worktree: a.ts',
      'something else',
    ]);
    expect(runView(state, 4000).groups[0]?.warnings).toBe(3);
    expect(formatGroup(view)).toContain(
      'Warning: files in the working copy changed during step Планировщик: swarm.yaml, README.md',
    );
  });

  it('gives later warnings of one step to later attempts and skips filled lists', () => {
    const state = run(1);
    for (const now of [1000, 2000, 3000]) {
      step(state, now);
      finish(state, 'needs_human', { now: now + 500 });
      transition(state, { kind: 'answer', group: 'gruppa-1', answer: 'да' }, now + 600);
    }
    const group = state.groups[0]!;
    expect(group.attempts.map((attempt) => attempt.stepId)).toEqual(['plan', 'plan', 'plan']);
    group.attempts[2]!.outsideChanges = ['new.ts'];
    group.warnings = [
      'step plan changed files outside its worktree: first.ts',
      'step plan changed files outside its worktree: second.ts',
    ];
    const view = groupView(state, group, '/w', null, 5000);
    expect(view.attempts.map((attempt) => attempt.outsideChanges)).toEqual([
      ['first.ts'],
      ['second.ts'],
      ['new.ts'],
    ]);
    expect(view.warnings).toEqual([]);
  });

  it('prints a group without refused calls as before', () => {
    const state = run(1);
    step(state, 1000);
    const text = formatGroup(groupView(state, state.groups[0]!, '/w', null, 2000));
    expect(text).not.toContain('denied:');
    expect(text).not.toContain('Permission hints');
  });

  it('shows diff statistics of runs, groups and files', () => {
    const state = run(1);
    step(state, 1000);
    const diff = {
      files: [
        { path: 'README.md', added: 1, removed: 0 },
        { path: 'logo.png', added: null, removed: null },
        { path: 'src/cli/web/server.ts', added: 366, removed: 2 },
      ],
      added: 367,
      removed: 2,
    };
    const view = runView(state, 2000, () => diff);
    expect(view.groups[0]?.diff).toEqual({ files: 3, added: 367, removed: 2 });
    expect(formatRun(view, 2000)).toContain('3 files +367 −2');
    const group = groupView(state, state.groups[0]!, '/w', null, 2000, diff);
    expect(formatGroup(group)).toContain(
      [
        'Changes: 3 files +367 −2',
        '  README.md +1 −0',
        '  logo.png (binary)',
        '  src/cli/web/server.ts +366 −2',
      ].join('\n'),
    );
  });

  it('shows a cancelled run as cancelled and a merged one as finished', () => {
    const cancelled = run(1);
    step(cancelled, 1000);
    transition(cancelled, { kind: 'cancel', group: null }, 2000);
    expect(runView(cancelled, 3000).state).toBe('cancelled');
    expect(formatRun(runView(cancelled, 3000), 3000)).toContain('· cancelled ·');
    expect(formatRunList([runView(cancelled, 3000)])).toContain('cancelled');
    const merged = run(1);
    merged.groups[0]!.status = 'merged';
    merged.run.finishedAt = 2000;
    expect(formatRun(runView(merged, 3000), 3000)).toContain('· finished ·');
    expect(formatRunList([runView(merged, 3000)])).not.toContain('cancelled');
  });

  it('shows the title and the name of a named run', () => {
    const state = run(1);
    state.run.title = 'Флаг --json';
    state.run.name = 'add-json-flag';
    expect(formatRun(runView(state, 2000), 2000)).toContain('Title: Флаг --json (add-json-flag)');
    expect(formatRunList([runView(state, 2000)])).toContain('Флаг --json');
  });

  it('lists runs by the first line of their task with the totals of merged groups', () => {
    const state = run(1);
    state.groups[0]!.task = 'добавить команду aip version\nподробности';
    state.groups[0]!.status = 'merged';
    const diff = { files: [{ path: 'a.ts', added: 5, removed: 1 }], added: 5, removed: 1 };
    const list = formatRunList([runView(state, 2000, () => diff)]);
    expect(list).toContain('добавить команду aip version');
    expect(list).toContain('1 file +5 −1');
    expect(list.split('\n')[0]).toContain('TITLE');
  });

  it('carries the workflow topology in the run view', () => {
    const state = run(1);
    step(state, 1000);
    const view = runView(state, 2000);
    expect(view.topology.steps.map((entry) => entry.id)).toEqual(['plan', 'code', 'review', 'qa']);
    expect(view.topology.steps[0]?.groups).toEqual([
      { slug: 'gruppa-1', title: 'Группа 1', status: 'running' },
    ]);
  });
});

describe('queue text', () => {
  it('shows the state, the stop reason, runs and numbered items', () => {
    const state = run(1);
    step(state, 1000);
    finish(state, 'needs_human', { feedback: 'вопрос', now: 2000 });
    const queue = emptyQueue('/repo', 1);
    // local time: the expected text does not depend on the time zone of the machine
    const first = new Date(2026, 10, 1, 14, 32).getTime();
    const second = new Date(2026, 11, 3, 9, 5).getTime();
    addItem(queue, { workflow: 'feature', task: 'первая строка\nвторая' }, 'q1', first);
    addItem(
      queue,
      {
        workflow: 'feature',
        groups: [
          { title: 'a', task: 'b' },
          { title: 'c', task: 'd' },
        ],
        title: 'Пара',
      },
      'q2',
      second,
    );
    queue.parallel = 2;
    queue.runs = [state.run.id];
    queue.stop = { kind: 'problem', run: state.run.id, group: 'gruppa-1', reason: 'needs_human' };
    const view = queueView(queue, (id) => (id === state.run.id ? state : undefined));
    expect(view.runs[0]).toMatchObject({ problem: { reason: 'needs_human' } });
    expect(formatQueue(view)).toBe(
      [
        'Queue: stopped, parallel 2 (1 of 2 places taken), autopilot off, auto answer off, skip failed off',
        'Stopped: run run000000001, group gruppa-1: needs_human',
        'Runs holding a place:',
        '  #1 run000000001  needs_human  feature  задача 1  0/1 groups · steps 0/4',
        '    problem: needs_human in gruppa-1',
        'Waiting:',
        '  1. #1 q1  feature  первая строка  added 2026-11-01 14:32',
        '  2. #2 q2  feature  2 groups [Пара]  added 2026-12-03 09:05',
      ].join('\n'),
    );
  });

  it('shows progress, active steps, delivery and splitting', () => {
    const working = run(3, { id: 'run00000000a' });
    step(working);
    group(working, 'gruppa-1').status = 'merged';
    const delivered = run(1, { id: 'run00000000b' });
    group(delivered).status = 'merged';
    group(delivered).delivery.state = 'pending';
    delivered.run.finishedAt = 5000;
    const queue = emptyQueue('/repo', 1);
    queue.status = 'running';
    queue.parallel = 2;
    queue.runs = [working.run.id, delivered.run.id];
    const view = queueView(queue, (id) =>
      id === working.run.id ? working : id === delivered.run.id ? delivered : undefined,
    );
    const text = formatQueue(view);
    expect(text).toContain('Queue: running, parallel 2 (2 of 2 places taken)');
    expect(text).toContain(
      'feature  Группа 1, Группа 2, Группа 3  1/3 groups · steps 4/12\n    gruppa-2: Планировщик',
    );
    expect(text).toContain('1/1 groups · steps 4/4 · delivering');
    const splitting = {
      ...view,
      runs: [
        {
          ...view.runs[0]!,
          groups: { done: 0, total: 0 },
          steps: { done: 0, total: 0, current: null },
        },
      ],
    };
    expect(formatQueue(splitting)).toContain('splitting');
  });

  it('marks the skipped steps of an item', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'x', skip: ['review', 'qa'] }, 'q1', 2);
    addItem(queue, { workflow: 'feature', task: 'y' }, 'q2', 2);
    const text = formatQueue(queueView(queue, () => undefined));
    expect(text).toMatch(/q1 {2}feature {2}x · skip: review, qa {2}added/);
    expect(text).not.toMatch(/q2.*skip/);
  });

  it('shows the predecessors and the readiness of an item', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'x' }, 'q1', 2);
    addItem(queue, { workflow: 'feature', task: 'y', after: ['q1', 'gone'] }, 'q2', 2);
    addItem(queue, { workflow: 'feature', task: 'z' }, 'q3', 2);
    const text = formatQueue(queueView(queue, () => undefined));
    expect(text).toMatch(/q2 {2}feature {2}y · after #1 q1, gone \(blocked\) {2}added/);
    expect(text).not.toMatch(/q1.*after/);
    expect(text).not.toMatch(/q3.*after/);
  });

  it('colours the blocked mark of an item', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'y', after: ['gone'] }, 'q1', 2);
    const view = queueView(queue, () => undefined);
    const style = createStyle(true);
    expect(formatQueue(view, style)).toContain(`after gone (${style.danger('blocked')})`);
  });

  it('marks the delivery of an item and of a run', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'x' }, 'q1', 2);
    addItem(queue, { workflow: 'feature', task: 'y', autoDeliver: false }, 'q2', 2);
    addItem(queue, { workflow: 'feature', task: 'z', autoDeliver: true }, 'q3', 2);
    const lines = formatQueue(queueView(queue, () => undefined, true)).split('\n');
    expect(lines.find((line) => line.includes('q1'))).not.toContain('delivery');
    expect(lines.find((line) => line.includes('q2'))).toContain('manual delivery');
    expect(lines.find((line) => line.includes('q3'))).toContain('auto delivery');
    expect(formatRun(runView(run(1, { autoDeliver: false }), 2000), 2000)).toContain(
      'manual delivery',
    );
    expect(formatRun(runView(run(1), 2000), 2000)).not.toContain('manual delivery');
  });

  it('marks the delivery mode of an item and a custom autopilot answer', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'x', deliveryMode: 'commit' }, 'q1', 2);
    addItem(queue, { workflow: 'feature', task: 'y' }, 'q2', 2);
    const plain = formatQueue(queueView(queue, () => undefined)).split('\n');
    expect(plain.find((line) => line.includes('q1'))).toContain('delivery: commit');
    expect(plain.find((line) => line.includes('q2'))).not.toContain('delivery:');
    expect(plain.join('\n')).not.toContain('Autopilot answer');
    queue.autopilotAnswer = 'Согласен\nи точка';
    expect(formatQueue(queueView(queue, () => undefined))).toContain('Autopilot answer: Согласен');
  });

  it('shows an item error and an empty queue', () => {
    const queue = emptyQueue('/repo', 1);
    expect(formatQueue(queueView(queue, () => undefined))).toBe(
      'Queue: stopped, parallel 1 (0 of 1 places taken), autopilot off, auto answer off, skip failed off\nNo tasks waiting.',
    );
    addItem(queue, { workflow: 'feature', task: 'x' }, 'q1', 2);
    queue.stop = { kind: 'item', item: 'q1', error: 'unknown workflow' };
    queue.items[0]!.error = 'unknown workflow';
    expect(formatQueue(queueView(queue, () => undefined))).toContain(
      'Stopped: item q1: unknown workflow',
    );
    itemStarted(queue, 'q1', 'r', 3);
    expect(queueView(queue, () => undefined).items).toEqual([]);
  });
});

describe('colored text', () => {
  const style = createStyle(true);
  const ansi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');
  const strip = (text: string): string =>
    ansi(text)
      .replace(/[✓✗▸◦⊘] |\? (?=needs_human)/g, '')
      .replace(/ +/g, ' ');

  it('shows a run with a failed group as failed', () => {
    const state = run(1);
    state.groups[0]!.status = 'failed';
    state.run.finishedAt = 2000;
    const view = runView(state, 3000);
    expect(view.state).toBe('failed');
    expect(formatRun(view, 3000)).toContain('· failed ·');
    expect(formatRunList([view])).toContain('failed');
    expect(formatRun(view, 3000, style)).toContain(style.danger('✗ failed'));
  });

  it('puts badges on states and aligns columns by visible width', () => {
    const state = run(2);
    state.groups[0]!.status = 'failed';
    state.groups[0]!.reason = 'сломалось';
    state.groups[1]!.status = 'running';
    const text = formatRun(runView(state, 5000), 5000, style);
    expect(text).toContain(style.danger('✗ failed'));
    expect(text).toContain(style.command('▸ running'));
    const lines = ansi(text).split('\n');
    const header = lines.find((line) => line.startsWith('GROUP'))!;
    const rows = lines.filter((line) => line.startsWith('gruppa-'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const at = header.indexOf('STEP');
      expect(row.slice(at - 2, at)).toBe('  ');
      expect(row[at]).not.toBe(' ');
    }
    expect(text).toContain(style.muted('GROUP'));
    expect(text).toContain(style.danger('сломалось'));
  });

  it('shows waiting and stopped states with badges', () => {
    const state = run(1);
    state.groups[0]!.status = 'needs_human';
    expect(formatRunList([runView(state, 2000)], style)).toContain(style.warning('? needs_human'));
    state.groups[0]!.status = 'cancelled';
    expect(formatRun(runView(state, 2000), 2000, style)).toContain('⊘ cancelled');
    const queue = {
      repository: '/repo',
      status: 'stopped' as const,
      parallel: 1,
      autopilot: false,
      autoAnswer: false,
      skipFailed: false,
      stop: null,
      items: [],
      runs: [],
      skipped: [],
      autoDeliver: true,
      deliveryMode: 'worktree' as const,
      autopilotAnswer: null,
      autopilotAnswerDefault: 'default',
      onLimit: 'wait' as const,
      freezeCandidate: null,
      updatedAt: 1,
    };
    expect(ansi(formatQueue(queue, style)).split('\n')[0]).toContain('◦ stopped');
    expect(strip(formatQueue(queue, style))).toBe(strip(formatQueue(queue)));
  });

  it('shows auto answer on separately from autopilot', () => {
    const queue = emptyQueue('/repo', 1);
    queue.autoAnswer = true;
    const view = queueView(queue, () => undefined);
    expect(formatQueue(view).split('\n')[0]).toBe(
      'Queue: stopped, parallel 1 (0 of 1 places taken), autopilot off, auto answer on, skip failed off',
    );
  });

  it('shows the modes and the skipped runs of the queue', () => {
    const state = run(1);
    step(state);
    group(state).status = 'failed';
    const queue = emptyQueue('/repo', 1);
    queue.autopilot = true;
    queue.skipFailed = true;
    queue.skipped = [state.run.id];
    const view = queueView(queue, (id) => (id === state.run.id ? state : undefined));
    expect(formatQueue(view)).toBe(
      [
        'Queue: stopped, parallel 1 (0 of 1 places taken), autopilot on, auto answer off, skip failed on',
        'Skipped with a problem:',
        `  #1 ${state.run.id}  failed  feature  задача 1  1/1 groups · steps 0/4 · delivering`,
        '    problem: failed in gruppa-1',
        'No tasks waiting.',
      ].join('\n'),
    );
  });

  it('paints added lines green and removed lines red', () => {
    const state = run(1);
    const view = runView(state, 2000);
    view.diff = { files: 6, added: 1124, removed: 0 };
    const text = formatRunList([view], style);
    expect(text).toContain(style.success('+1124'));
    expect(text).toContain(style.danger('−0'));
    expect(strip(text)).toBe(strip(formatRunList([view])));
  });

  it('paints warnings yellow in a group', () => {
    const state = run(1);
    const view = groupView(state, state.groups[0]!, '/w', null, 2000);
    view.warnings = ['осторожно'];
    expect(formatGroup(view, style)).toContain(style.warning('Warning: осторожно'));
    expect(strip(formatGroup(view, style))).toBe(strip(formatGroup(view)));
  });

  it('prints plain text without a style', () => {
    expect(formatRepositories([], style)).toBe('No repositories yet.');
    const text = formatRepositories(
      [{ path: '/r', unfinished: 1, waiting: 0, queued: 2 }] as never,
      style,
    );
    expect(strip(text)).toContain('REPOSITORY');
  });
});

describe('formatRunQueued', () => {
  const created = {
    runId: 'run1',
    number: 1,
    branch: 'aip/run1',
    groups: [{ slug: 'a', title: 'A' }],
    split: false,
    warnings: [],
  };

  function queueWith(taken: number, parallel: number) {
    const state = run(1);
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'x' }, 'q1', 2);
    queue.status = 'running';
    queue.parallel = parallel;
    queue.runs = Array.from({ length: taken }, () => state.run.id);
    return queueView(queue, (id) => (id === state.run.id ? state : undefined));
  }

  it('prints the created run as before', () => {
    expect(
      formatRunQueued({ item: 'q1', number: 1, run: created, queue: queueWith(1, 2) }),
    ).toContain('Run #1 run1 started (aip/run1).');
  });

  it('prints the position of a waiting task and the taken places', () => {
    expect(formatRunQueued({ item: 'q1', number: 1, run: null, queue: queueWith(1, 1) })).toBe(
      'Task #1 q1 queued at position 1 (queue running, 1 of 1 places taken).',
    );
  });

  it('shows places taken over the limit', () => {
    expect(formatQueue(queueWith(3, 2))).toContain('(3 of 2 places taken)');
  });
});

describe('tags in text', () => {
  const tags = [
    { id: 'tg-a', name: 'auth', color: 'blue' as const, task: null },
    { id: 'tg-b', name: 'v2', color: 'red' as const, task: null },
  ];
  const runWith = (id: string, own: typeof tags) => ({
    ...runView(run(1, { id }), 1000),
    tags: own,
  });

  it('puts #labels in the run list and the run header', () => {
    const tagged = runWith('run00000000a', tags);
    expect(formatRunList([tagged])).toContain('#auth #v2');
    expect(formatRun(tagged, 2000)).toContain('Tags: #auth #v2');
    expect(formatRunList([runWith('run00000000b', [])])).not.toContain('#a');
    expect(formatRun(runWith('run00000000b', []), 2000)).not.toContain('Tags:');
  });

  it('puts #labels on waiting tasks', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'x', tags: ['tg-a', 'tg-b'] }, 'q1', 2);
    const catalog = tags.map((tag) => ({ ...tag, createdAt: 1 }));
    expect(formatQueue(queueView(queue, () => undefined, null, catalog))).toContain('#auth #v2');
  });

  it('lists the tag catalog', () => {
    expect(formatTagList([])).toBe('No tags yet.');
    const text = formatTagList(tags);
    expect(text).toContain('auth');
    expect(text).toContain('blue');
  });

  it('labels a linked task tag with the task number and lists it in TASK', () => {
    const linked = {
      id: 'tg-l',
      name: 'cards',
      color: 'indigo' as const,
      task: { run: 'r1', number: 115 },
    };
    expect(formatTagLabels([linked, tags[0]!])).toBe('#115:cards #auth');
    const text = formatTagList([linked, tags[0]!]);
    expect(text).toContain('TASK');
    expect(text).toContain('#115');
    expect(text).toContain('—');
  });

  it('keeps runs with any of the tags, ignoring case', () => {
    const a = runWith('run00000000a', [tags[0]!]);
    const b = runWith('run00000000b', [tags[1]!]);
    const c = runWith('run00000000c', []);
    expect(filterByTags([a, b, c], ['AUTH', 'v2']).map((entry) => entry.id)).toEqual([
      'run00000000a',
      'run00000000b',
    ]);
    expect(filterByTags([a, b, c], ['auth']).map((entry) => entry.id)).toEqual(['run00000000a']);
    expect(filterByTags([a, b, c], ['nope'])).toEqual([]);
  });
});

describe('usage limit in the text output', () => {
  const RESET = new Date(2026, 10, 2, 20, 50).getTime();

  it('shows the stop by a usage limit and a returned run in the queue', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'работа' }, 'q1', 2);
    queue.items[0]!.run = 'run000000001';
    queue.stop = {
      kind: 'limit',
      run: 'A',
      group: 'a',
      runtime: 'claude',
      resetsAt: RESET,
      autoResume: true,
    };
    queue.onLimit = 'stop';
    const text = formatQueue(queueView(queue, () => run(1)));
    expect(text.split('\n')[0]).toMatch(/, on limit stop$/);
    expect(text).toContain(
      'Stopped: usage limit of claude in A, resets 20:50, resumes automatically',
    );
    expect(text).toContain('returns run000000001');
    queue.stop.autoResume = false;
    expect(formatQueue(queueView(queue, () => run(1)))).toContain(
      'Stopped: usage limit of claude in A, resets 20:50\n',
    );
  });

  it('marks the item of a paused run', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'работа' }, 'q1', 2);
    queue.items[0]!.run = 'run000000001';
    const paused = run(1);
    paused.run.hold = 'paused';
    expect(formatQueue(queueView(queue, () => paused))).toContain('paused run000000001');
    expect(formatRunList([runView(paused, 1000)])).toContain('paused');
  });

  it('shows frozen for the item of a frozen run, priority on a card and frozen in the state column', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { workflow: 'feature', task: 'работа' }, 'q1', 2);
    queue.items[0]!.run = 'run000000001';
    const frozen = run(1);
    frozen.run.hold = 'frozen';
    const text = formatQueue(queueView(queue, () => frozen));
    expect(text).toContain('frozen run000000001');
    const other = run(1, { id: 'run000000002' });
    step(other);
    const taken = emptyQueue('/repo', 1);
    taken.runs = ['run000000002'];
    taken.priority = ['run000000002'];
    expect(formatQueue(queueView(taken, () => other))).toContain('priority');
    expect(formatRun(runView(frozen, 1000), 1000)).toContain('· frozen ·');
  });

  it('shows a group waiting for the limit', () => {
    const state = run(1);
    step(state);
    const seq = group(state).attempts[0]!.seq;
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq,
        exit: {
          sessionId: 's',
          usage: null,
          failure: { kind: 'usage_limit', resetsAt: RESET },
          outsideChanges: [],
        },
      },
      2000,
    );
    expect(formatRun(runView(state, 3000), 3000)).toContain('queued (usage limit, until 20:50)');
  });
});

describe('live usage in text', () => {
  it('shows the usage of a running attempt in the status of a run and of a group', () => {
    const state = run(1);
    step(state, 1000);
    transition(
      state,
      {
        kind: 'attempt_usage',
        updates: [
          {
            group: 'gruppa-1',
            seq: 1,
            usage: { inputTokens: 1200, outputTokens: 300, costUsd: null },
          },
        ],
      },
      2000,
    );
    expect(formatRun(runView(state, 3000), 3000)).toContain('usage 1200 in / 300 out');
    const text = formatGroup(groupView(state, state.groups[0]!, '/w', null, 3000));
    expect(text).toContain('Usage: 1200 in / 300 out');
    expect(text).toContain('running');
  });
});

describe('system stages and waiting in text', () => {
  const specialistWait: GroupWait = {
    reason: 'specialist',
    specialist: 'coder',
    name: 'Coder',
    max: 1,
  };

  it('prints a System line instead of Split with the delivery stage last', () => {
    const state = run(1, { split: true, configText: CONFIG_TEXT });
    const base = group(state);
    state.split = { ...base, slug: '_split', status: 'merged', attempts: [] };
    state.message = { ...base, slug: '_message', status: 'running', attempts: [] };
    base.status = 'merged';
    const text = formatRun(runView(state, 3000), 3000);
    expect(text).toContain('System: split done · message running · delivery pending');
    expect(text).not.toContain('Split:');
  });

  it('prints the reason of a failed delivery', () => {
    const state = run(1);
    const first = group(state);
    first.status = 'merged';
    first.delivery = {
      ...first.delivery,
      state: 'apply_failed',
      reason: 'does not exist in index',
    };
    expect(formatRun(runView(state, 3000), 3000)).toContain(
      'System: delivery apply_failed (does not exist in index)',
    );
  });

  it('has no System line without system stages', () => {
    expect(formatRun(runView(run(1), 3000), 3000)).not.toContain('System:');
  });

  it('shows a waiting group in the table with the reason', () => {
    const state = run(1);
    const text = formatRun(
      runView(
        state,
        3000,
        () => null,
        [],
        () => specialistWait,
      ),
      3000,
    );
    expect(text).toContain('waiting for coder');
    expect(text).toMatch(/gruppa-1\s+waiting/);
    expect(text).toContain('waiting 1');
  });

  it('shows the swarm capacity and the usage limit in the note', () => {
    expect(waitNote({ reason: 'capacity', max: 2 })).toBe('waiting for a free place (swarm.max 2)');
    expect(waitNote({ reason: 'limit', runtime: 'claude', until: 0 })).toMatch(
      /^waiting for claude usage limit, until \d\d:\d\d$/,
    );
    expect(waitNote(null)).toBe('');
  });

  it('lists the waiting groups on the line of the run of the queue', () => {
    const state = run(1);
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    const text = formatQueue(
      queueView(
        queue,
        () => state,
        null,
        [],
        null,
        () => specialistWait,
      ),
    );
    expect(text).toContain('gruppa-1: Планировщик (waiting for coder)');
  });
});

describe('skipped steps in text', () => {
  it('names the steps skipped after the start, and says nothing otherwise', () => {
    const state = run(1);
    expect(formatRun(runView(state, 1000), 1000)).not.toContain('Skipped steps');
    state.run.skippedSteps = ['review', 'qa'];
    expect(formatRun(runView(state, 1000), 1000)).toContain(
      'Skipped steps: Ревьюер (review), Тестировщик (qa)',
    );
  });

  it('does not repeat the id of a step whose name already carries it', () => {
    const view = runView(run(1), 1000);
    view.steps = [
      {
        id: 'review',
        specialist: 'reviewer',
        name: 'Ревьюер (review)',
        skipped: true,
        state: 'upcoming',
      },
      {
        id: 'review-2',
        specialist: 'reviewer',
        name: 'Ревьюер (review-2)',
        skipped: true,
        state: 'upcoming',
      },
    ];
    expect(formatRun(view, 1000)).toContain('Skipped steps: Ревьюер (review), Ревьюер (review-2)');
  });
});

describe('name of the workflow in text', () => {
  const named = CONFIG_TEXT.replace('    feature:\n', '    feature:\n      name: Новая функция\n');

  it('prints «name (id)» in the run header, and the id alone without a name', () => {
    expect(formatRun(runView(run(1, { configText: named }), 1000), 1000)).toContain(
      'Новая функция (feature) ·',
    );
    expect(formatRun(runView(run(1), 1000), 1000)).toContain(' · feature · ');
  });

  it('prints «name (id)» in the run list and in the queue lines', () => {
    expect(workflowLabel('feature', 'Новая функция')).toBe('Новая функция (feature)');
    expect(workflowLabel('feature', 'feature')).toBe('feature');
    expect(formatRunList([runView(run(1, { configText: named }), 1000)])).toContain(
      'Новая функция (feature)',
    );
  });
});
