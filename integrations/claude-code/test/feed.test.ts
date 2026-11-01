import { describe, expect, test } from 'claude-code/testing';

import {
  aipArgv,
  ATTENTION_SHOWN,
  answerText,
  applyEvent,
  attentionItems,
  describeApply,
  describeRunCreated,
  describeRunQueued,
  parseRunQueued,
  formatAge,
  formatDiff,
  missingAnswers,
  paneView,
  parseAipTool,
  resolveAnswers,
  runLabel,
  runMarkdown,
  runProgress,
  sortRuns,
  statusMarkdown,
  toolData,
  toolSummary,
  groupActions,
  newNotices,
  parseApplyCommand,
  parseEvent,
  parseRunCommand,
  parseRuns,
  parseStatusCommand,
  parseWebCommand,
  parseWebUrl,
  runActions,
  selectedRun,
  splitLines,
  statusSummary,
  webArgv,
} from '../hooks/feed.ts';

import { group, legacyRun, run, runLine, snapshotLine } from './fixtures.ts';

const STREAM = { mode: 'stream', error: null } as const;

describe('stream', () => {
  test('lines are split across chunks', () => {
    const first = splitLines('', '{"a":1}\n{"b"');
    expect(first).toEqual({ lines: ['{"a":1}'], rest: '{"b"' });
    expect(splitLines(first.rest, ':2}\n')).toEqual({ lines: ['{"b":2}'], rest: '' });
  });

  test('snapshot and run events are parsed, anything else is not', () => {
    const one = run('r1', [group('login')]);
    expect(parseEvent(snapshotLine([one]).trim())).toEqual({
      event: 'snapshot',
      seq: 1,
      runs: [one],
    });
    expect(parseEvent(runLine(one, 7).trim())).toEqual({ event: 'run', seq: 7, run: one });
    expect(parseEvent('not json')).toBeNull();
    expect(parseEvent('{"event":"run","seq":1,"run":{"id":1}}')).toBeNull();
    expect(parseEvent('{"event":"other","seq":1}')).toBeNull();
  });

  test('status output is a list of runs', () => {
    const one = run('r1', [group('login')]);
    expect(parseRuns(JSON.stringify([one]))).toEqual([one]);
    expect(parseRuns('{"id":"r1"}')).toBeNull();
  });

  test('a snapshot replaces the runs, a run event updates or adds one', () => {
    const first = run('r1', [group('login')]);
    const second = run('r2', [group('signup')]);
    const runs = applyEvent([first], { event: 'snapshot', seq: 1, runs: [first, second] });
    expect(runs.map((one) => one.id)).toEqual(['r1', 'r2']);
    const changed = run('r2', [group('signup', { step: 'review' })]);
    expect(applyEvent(runs, { event: 'run', seq: 2, run: changed })[1]).toEqual(changed);
    const added = run('r3', []);
    expect(applyEvent(runs, { event: 'run', seq: 3, run: added })[0]).toEqual(added);
  });
});

describe('status line', () => {
  const live = (...groups: ReturnType<typeof group>[]) => [
    run('r1', groups, { title: 'Add login' }),
  ];

  test('is idle without active runs', () => {
    expect(statusSummary([], STREAM)).toBe('aip: idle');
    expect(statusSummary([run('r1', [], { finished: true })], STREAM)).toBe('aip: idle');
  });

  test('names a single run and counts its groups', () => {
    const runs = live(group('a'), group('b'), group('c', { status: 'needs_human' }));
    expect(statusSummary(runs, STREAM)).toBe('aip: Add login · 2 running · 1 question');
    const two = live(group('a', { status: 'needs_human' }), group('b', { status: 'needs_human' }));
    expect(statusSummary(two, STREAM)).toBe('aip: Add login · 2 questions');
  });

  test('falls back to the run id and truncates long titles', () => {
    expect(statusSummary([run('r9', [group('a')])], STREAM)).toBe('aip: r9 · 1 running');
    const long = [run('r1', [group('a')], { title: 'x'.repeat(50) })];
    expect(statusSummary(long, STREAM)).toBe(`aip: ${'x'.repeat(29)}… · 1 running`);
  });

  test('counts runs when several are active', () => {
    const runs = [
      run('r1', [group('a'), group('b', { status: 'failed' })]),
      run('r2', [group('c', { status: 'conflict' })]),
      run('r3', [group('d', { status: 'merged' })], { finished: true }),
    ];
    expect(statusSummary(runs, STREAM)).toBe('aip: 2 runs · 1 running · 1 failed · 1 conflict');
  });

  test('leaves merging and queued groups out of the counters', () => {
    const runs = live(group('a', { status: 'merging' }), group('b', { status: 'queued' }));
    expect(statusSummary(runs, STREAM)).toBe('aip: Add login');
  });

  test('says when aip is offline or connecting', () => {
    expect(statusSummary([], { mode: 'polling', error: 'boom' })).toBe('aip: offline');
    expect(statusSummary([], { mode: 'connecting', error: null })).toBe('aip: connecting');
  });

  test('says when aip cannot be run', () => {
    expect(statusSummary([], { mode: 'missing', error: 'cannot run' })).toBe(
      'aip: command not found, set the aipCommand option',
    );
  });
});

describe('notices', () => {
  const asking = run('r1', [
    group('login', { status: 'needs_human', question: 'OAuth или пароль?\nПодробнее ниже' }),
  ]);

  test('a question is shown once, with the group and its first line', () => {
    const first = newNotices([asking], [], false);
    expect(first.notices.map((notice) => notice.text)).toEqual([
      'login · r1 asks: OAuth или пароль?',
    ]);
    expect(newNotices([asking], first.notified, false).notices).toEqual([]);
  });

  test('failed, conflict, apply_failed and a finished run are shown', () => {
    const runs = [
      run('r1', [
        group('a', { status: 'failed', reason: 'tests failed' }),
        group('b', { status: 'conflict' }),
        group('c', { status: 'merged', delivery: 'apply_failed' }),
      ]),
      run('r2', [], { finished: true, counts: '1 merged' }),
    ];
    expect(newNotices(runs, [], false).notices.map((notice) => notice.text)).toEqual([
      'a · r1 failed: tests failed',
      'b · r1 has a merge conflict',
      'delivery of c failed (r1)',
      'run r2 (feature) finished: 1 merged',
    ]);
  });

  test('the first load shows only questions and remembers the rest', () => {
    const runs = [asking, run('r2', [], { finished: true })];
    const first = newNotices(runs, [], true);
    expect(first.notices.map((notice) => notice.text)).toEqual([
      'login · r1 asks: OAuth или пароль?',
    ]);
    expect(newNotices(runs, first.notified, false).notices).toEqual([]);
  });

  test('a new question of the same group is shown again', () => {
    const { notified } = newNotices([asking], [], false);
    const again = run('r1', [
      group('login', { status: 'needs_human', question: 'А токены где хранить?', round: 2 }),
    ]);
    expect(newNotices([again], notified, false).notices).toHaveLength(1);
  });
});

describe('actions', () => {
  test('follow the state of a group', () => {
    expect(groupActions(group('a', { status: 'needs_human' }))).toEqual(['answer', 'cancel']);
    expect(groupActions(group('a', { status: 'failed' }))).toEqual(['retry']);
    expect(groupActions(group('a', { status: 'conflict' }))).toEqual(['retry', 'cancel']);
    expect(groupActions(group('a', { status: 'running' }))).toEqual(['cancel']);
    expect(groupActions(group('a', { status: 'merged' }))).toEqual(['apply']);
    expect(groupActions(group('a', { status: 'merged', delivery: 'applied' }))).toEqual([]);
    expect(groupActions(group('a', { status: 'cancelled' }))).toEqual([]);
  });

  test('follow the state of a run', () => {
    expect(runActions(run('r1', [group('a')]))).toEqual(['cancel']);
    expect(runActions(run('r1', [group('a', { status: 'merged' })], { finished: true }))).toEqual([
      'apply',
    ]);
  });

  test('the selected run defaults to the first active one', () => {
    const runs = [run('r1', [], { finished: true }), run('r2', [])];
    expect(selectedRun(runs, null)?.id).toBe('r2');
    expect(selectedRun(runs, 'r1')?.id).toBe('r1');
    expect(selectedRun(runs, 'gone')?.id).toBe('r2');
    expect(selectedRun([], null)).toBeNull();
  });

  test('a rejected delivery names its reason and files', () => {
    expect(
      describeApply({
        runId: 'r1',
        pending: false,
        groups: [
          {
            slug: 'login',
            delivery: {
              state: 'apply_failed',
              reason: 'your changes touch the same files',
              files: ['src/login.ts'],
              conflicts: [],
            },
          },
        ],
      }),
    ).toEqual({
      text: '- ✕ **login**: apply failed: your changes touch the same files (files: src/login.ts)',
      plain: 'login: apply failed: your changes touch the same files (files: src/login.ts)',
      isError: true,
    });
  });
});

describe('commands', () => {
  test('/aip:run takes a workflow and the rest as the task', () => {
    expect(parseRunCommand('feature добавить вход')).toEqual({
      ok: true,
      value: { workflow: 'feature', task: 'добавить вход' },
    });
    expect(parseRunCommand('feature')).toEqual({
      ok: false,
      error: 'Usage: /aip:run <workflow> <task>',
    });
    expect(parseRunCommand('').ok).toBe(false);
  });

  test('/aip:status takes an optional run id', () => {
    expect(parseStatusCommand('')).toEqual({ ok: true, value: null });
    expect(parseStatusCommand(' r1 ')).toEqual({ ok: true, value: 'r1' });
    expect(parseStatusCommand('r1 r2').ok).toBe(false);
  });

  test('/aip:apply takes a run id, groups and --force', () => {
    expect(parseApplyCommand('r1 login signup --force')).toEqual({
      ok: true,
      value: { runId: 'r1', groups: ['login', 'signup'], force: true },
    });
    expect(parseApplyCommand('r1')).toEqual({
      ok: true,
      value: { runId: 'r1', groups: [], force: false },
    });
    expect(parseApplyCommand('').ok).toBe(false);
    expect(parseApplyCommand('r1 --dry').ok).toBe(false);
  });

  test('the web command is parsed', () => {
    expect(parseWebCommand('')).toEqual({ ok: true, value: { action: 'start', port: null } });
    for (const action of ['start', 'stop', 'restart', 'status'] as const)
      expect(parseWebCommand(action)).toEqual({ ok: true, value: { action, port: null } });
    expect(parseWebCommand('--port 8080')).toEqual({
      ok: true,
      value: { action: 'start', port: 8080 },
    });
    expect(parseWebCommand('restart --port 0')).toEqual({
      ok: true,
      value: { action: 'restart', port: 0 },
    });
    for (const bad of ['--port 70000', '--port x', '--port', 'start now', 'stop restart'])
      expect(parseWebCommand(bad)).toEqual({
        ok: false,
        error: 'Usage: /aip:web [start|stop|restart|status] [--port <n>]',
      });
    expect(webArgv(null)).toEqual(['web']);
    expect(webArgv(8080)).toEqual(['web', '--port', '8080']);
  });

  test('the web link is found in the output of aip web', () => {
    expect(parseWebUrl('aip web: http://127.0.0.1:7341/?token=abc')).toBe(
      'http://127.0.0.1:7341/?token=abc',
    );
    expect(parseWebUrl('aip web: http://[::1]:7341/?token=abc')).toBe(
      'http://[::1]:7341/?token=abc',
    );
    expect(parseWebUrl('Press Ctrl+C to stop.')).toBeNull();
  });

  test('the aip command option is a list or a string', () => {
    expect(aipArgv(['node', '/x/main.js'])).toEqual(['node', '/x/main.js']);
    expect(aipArgv('node /x/main.js')).toEqual(['node', '/x/main.js']);
    expect(aipArgv([])).toEqual(['aip']);
    expect(aipArgv(undefined)).toEqual(['aip']);
  });
});

const FULL = { compact: false, now: 1_000_000 } as const;

describe('run display', () => {
  const titled = run(
    'r1',
    [
      group('a', { status: 'merged' }),
      group('b', { status: 'merged' }),
      group('c', { status: 'merged' }),
      group('d', { status: 'running' }),
      group('e', { status: 'needs_human', question: 'Auth?' }),
    ],
    { title: 'Add login', diff: { files: 4, added: 120, removed: 8 } },
  );

  test('the title replaces the id, an old daemon shows the id', () => {
    expect(runLabel(titled)).toBe('Add login');
    expect(runLabel(legacyRun('r7'))).toBe('r7');
    expect(runLabel(run('r8', [], { title: '  ' }))).toBe('r8');
  });

  test('progress counts merged and cancelled groups', () => {
    expect(runProgress(titled)).toEqual({ done: 3, total: 5 });
    expect(runProgress(run('r2', [group('a', { status: 'cancelled' })]))).toEqual({
      done: 1,
      total: 1,
    });
  });

  test('a diff is formatted, a missing one is null', () => {
    expect(formatDiff({ files: 4, added: 120, removed: 8 })).toBe('4 files +120 −8');
    expect(formatDiff({ files: 1, added: 1, removed: 0 })).toBe('1 file +1 −0');
    expect(formatDiff(null)).toBeNull();
    expect(formatDiff(undefined)).toBeNull();
  });

  test('active runs come first, newest first', () => {
    const runs = [
      run('old', [], { finished: true, createdAt: 9 }),
      run('a1', [], { createdAt: 1 }),
      run('a2', [], { createdAt: 2 }),
    ];
    expect(sortRuns(runs).map((one) => one.id)).toEqual(['a2', 'a1', 'old']);
  });

  test('an age is short', () => {
    expect([0, 59_000, 300_000, 7_200_000, 259_200_000].map(formatAge)).toEqual([
      'now',
      'now',
      '5m',
      '2h',
      '3d',
    ]);
  });
});

describe('attention', () => {
  test('a question of another run is listed with the run name', () => {
    const runs = [
      run('r2', [group('signup')]),
      run('r1', [group('login', { status: 'needs_human', question: 'OAuth?\nmore' })], {
        title: 'Add login',
      }),
    ];
    const { items, more } = attentionItems(runs);
    expect(more).toBe(0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      runId: 'r1',
      slug: 'login',
      runLabel: 'Add login',
      text: 'OAuth?',
    });
  });

  test('nothing to decide gives an empty list', () => {
    const runs = [run('r1', [group('a'), group('b', { status: 'merged' })])];
    expect(attentionItems(runs)).toEqual({ items: [], more: 0 });
  });

  test('a rejected delivery and a split question count', () => {
    const runs = [
      run('r1', [group('a', { status: 'merged', delivery: 'apply_failed' })], {
        split: { status: 'needs_human', question: 'Which scope?', reason: null },
      }),
    ];
    expect(attentionItems(runs).items.map((item) => item.slug)).toEqual(['_split', 'a']);
  });

  test('no more than five rows, the rest is counted', () => {
    const many = run(
      'r1',
      Array.from({ length: 8 }, (_, index) => group(`g${index}`, { status: 'failed' })),
    );
    const { items, more } = attentionItems([many]);
    expect(items).toHaveLength(ATTENTION_SHOWN);
    expect(more).toBe(3);
  });
});

describe('pane view', () => {
  test('active runs first, finished ones dim, the rest folded into +N more', () => {
    const runs = [
      ...Array.from({ length: 9 }, (_, index) =>
        run(`f${index}`, [group('a', { status: 'merged' })], { finished: true, createdAt: index }),
      ),
      run('a1', [group('x')], { createdAt: 100 }),
      run('a2', [group('y')], { createdAt: 200 }),
    ];
    const view = paneView(runs, null, STREAM, FULL);
    expect(view.runs).toHaveLength(8);
    expect(view.runs.slice(0, 2).map((row) => row.id)).toEqual(['a2', 'a1']);
    expect(view.runs.slice(2).every((row) => row.isDim)).toBe(true);
    expect(view.runs.map((row) => row.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(view.hiddenRuns).toBe(3);
    expect(view.summary).toBe('aip · 2 active');
    expect(view.runs[0]?.isSelected).toBe(true);
  });

  test('the phase of a failed run is failed, without state it follows finished', () => {
    const failed = run('r1', [group('a', { status: 'failed' })], {
      finished: true,
      state: 'failed',
    });
    const legacy = run('r2', [group('a', { status: 'merged' })], { finished: true });
    expect(paneView([failed], 'r1', STREAM, FULL).current?.phase).toBe('failed');
    expect(paneView([legacy], 'r2', STREAM, FULL).current?.phase).toBe('finished');
  });

  test('the summary counts what needs the user', () => {
    const runs = [run('r1', [group('a', { status: 'needs_human', question: 'Q' })])];
    expect(paneView(runs, null, STREAM, FULL).summary).toBe('aip · 1 active · 1 needs you');
  });

  test('the narrow layout drops age and cost', () => {
    const merged = run('r1', [
      group('a', { status: 'merged', diff: { files: 1, added: 2, removed: 3 } }),
    ]);
    const wide = paneView([merged], null, STREAM, FULL);
    const narrow = paneView([merged], null, STREAM, { compact: true, now: 1_000_000 });
    expect(wide.runs[0]?.age).toBe('16m');
    expect(wide.runs[0]?.cost).toBe('$0.01');
    expect(narrow.runs[0]?.age).toBeNull();
    expect(narrow.runs[0]?.cost).toBeNull();
  });

  test('the connection is a symbol, a label and a theme key', () => {
    const view = (mode: 'stream' | 'polling' | 'missing' | 'connecting') =>
      paneView([], null, { mode, error: 'boom' }, FULL).connection;
    expect(view('stream')).toMatchObject({ icon: '●', color: 'success' });
    expect(view('polling')).toMatchObject({ icon: '◌', color: 'warning' });
    expect(view('missing')).toMatchObject({ icon: '✕', color: 'error' });
    expect(view('connecting').color).toBe('inactive');
  });

  test('a run from an old daemon is shown without new fields', () => {
    const view = paneView([legacyRun('r1')], null, STREAM, FULL);
    expect(view.runs[0]?.label).toBe('r1');
    expect(view.card?.diff).toBeNull();
    expect(view.card?.phase).toBe('active');
    expect(view.card?.groups[0]?.diff).toBeNull();
    expect(view.card?.groups[0]?.questions).toBeNull();
  });

  test('a merged group shows its delivery, a running one does not', () => {
    const view = paneView(
      [run('r1', [group('a', { status: 'merged', delivery: 'applied' }), group('b')])],
      null,
      STREAM,
      FULL,
    );
    expect(view.card?.groups[0]?.delivery?.icon).toBe('✓');
    expect(view.card?.groups[1]?.delivery).toBeNull();
  });
});

describe('answers', () => {
  const questions = [
    { text: 'Auth?', options: ['OAuth', 'Password'], recommendation: 'OAuth' },
    { text: 'Where?' },
  ];

  test('the text uses the Q/A form of the web panel', () => {
    expect(answerText(questions, ['OAuth', 'cookie'])).toBe(
      'Q1: Auth?\nA1: OAuth\n\nQ2: Where?\nA2: cookie',
    );
  });

  test('the recommendation is the default, a draft wins', () => {
    expect(resolveAnswers(questions, () => undefined)).toEqual(['OAuth', '']);
    expect(resolveAnswers(questions, (index) => (index === 0 ? ' Password ' : 'x'))).toEqual([
      'Password',
      'x',
    ]);
  });

  test('missing answers are numbered from one', () => {
    expect(missingAnswers(['OAuth', ''])).toEqual([2]);
    expect(missingAnswers(['', ' '])).toEqual([1, 2]);
    expect(missingAnswers(['a'])).toEqual([]);
  });
});

describe('markdown output', () => {
  const login = run('r1', [group('a', { status: 'merged' }), group('b')], {
    title: 'Add login',
    total: 5,
    diff: { files: 4, added: 120, removed: 8 },
  });

  test('a list has one line per run, active first', () => {
    const text = statusMarkdown([
      run('old', [group('a', { status: 'merged' })], { finished: true, createdAt: 5 }),
      login,
    ]);
    const lines = text.split('\n');
    expect(lines[0]).toContain('**Add login**');
    expect(lines[0]).toContain('`r1`');
    expect(lines[0]).toContain('1/5');
    expect(lines[0]).toContain('4 files +120 −8');
    expect(lines[1]).toContain('`old`');
    expect(text).not.toMatch(/ {2,}/);
  });

  test('an empty list tells how to start', () => {
    expect(statusMarkdown([])).toContain('/aip:run');
  });

  test('a run lists its groups with the first line of a question', () => {
    const text = runMarkdown(
      run('r1', [group('a', { status: 'needs_human', question: 'Auth?\nmore' })], {
        title: 'Add login',
      }),
    );
    expect(text).toContain('### ? Add login · `r1`');
    expect(text).toContain('**a** needs you');
    expect(text).toContain('“Auth?”');
    expect(text).not.toContain('more');
  });

  test('a created run lists groups and warnings', () => {
    expect(
      describeRunCreated({
        runId: 'r9',
        branch: 'aip/r9',
        groups: [{ slug: 'login', title: 'Add login' }],
        split: false,
        warnings: ['dirty tree'],
      }),
    ).toBe('**r9** started on `aip/r9`\n\n- **login** — Add login\n\n⚠ dirty tree');
    expect(
      describeRunCreated({ runId: 'r9', branch: 'b', groups: [], split: true, warnings: [] }),
    ).toContain('split into groups first');
  });

  test('a queued run is the created run or the place in the queue', () => {
    const queue = {
      status: 'running',
      parallel: 2,
      items: [{ id: 'q7', position: 3 }],
      runs: [{}, {}],
    };
    const created = { runId: 'r9', branch: 'aip/r9', groups: [], split: true, warnings: [] };
    expect(describeRunQueued({ item: 'q7', run: created, queue })).toBe(
      describeRunCreated(created),
    );
    expect(describeRunQueued({ item: 'q7', run: null, queue })).toBe(
      '**q7** queued at position 3 · 2 of 2 places taken',
    );
    expect(parseRunQueued(JSON.stringify({ item: 'q7', run: null, queue }))?.item).toBe('q7');
    expect(parseRunQueued(JSON.stringify(created))).toBeNull();
    expect(parseRunQueued('not json')).toBeNull();
  });
});

describe('tool rows', () => {
  const block = (data: unknown) => `Text\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``;
  const active = run(
    'r1',
    [
      group('a', { status: 'merged' }),
      group('b', { status: 'merged' }),
      group('c', { status: 'merged' }),
      group('d'),
      group('e', { status: 'needs_human', question: 'Q' }),
    ],
    { title: 'Add login', waiting: 1 },
  );

  test('only known swarm tools are recognised', () => {
    expect(parseAipTool('mcp__aip__swarm_status')).toBe('status');
    expect(parseAipTool('mcp__x__y__swarm_queue_add')).toBe('queue_add');
    expect(parseAipTool('mcp__aip__swarm_queue_parallel')).toBe('queue_parallel');
    expect(parseAipTool('mcp__aip__swarm_unknown')).toBeNull();
    expect(parseAipTool('Bash')).toBeNull();
  });

  test('the JSON is read from a string, content parts and a content object', () => {
    const text = block([1]);
    expect(toolData(text)).toEqual([1]);
    expect(toolData([{ type: 'text', text }])).toEqual([1]);
    expect(toolData({ content: [{ type: 'text', text }] })).toEqual([1]);
    expect(toolData(`${block(['old'])}\n${text}`)).toEqual([1]);
  });

  test('anything unreadable gives null', () => {
    expect(toolData('plain text')).toBeNull();
    expect(toolData('```json\n{broken\n```')).toBeNull();
    expect(toolData(42)).toBeNull();
    expect(toolData({ stdout: 'x' })).toBeNull();
  });

  test('status summarises active runs', () => {
    expect(toolSummary('status', [active])).toBe(
      'aip · status — 1 active: Add login 3/5 · 1 needs answer',
    );
    expect(toolSummary('status', [])).toBe('aip · status — no active runs');
    expect(toolSummary('status', active)).toBe('aip · status — Add login 3/5 · 1 needs answer');
    expect(toolSummary('status', 'nope')).toBeNull();
  });

  test('run, apply and the others have their own summary', () => {
    expect(
      toolSummary('run', {
        item: 'q1',
        run: {
          runId: 'r1',
          branch: 'b',
          groups: [{ slug: 'a', title: 'A' }],
          split: false,
          warnings: [],
        },
        queue: { status: 'running', parallel: 1, items: [], runs: [{}] },
      }),
    ).toBe('aip · run — r1 started: a');
    expect(
      toolSummary('run', {
        item: 'q2',
        run: null,
        queue: { status: 'running', parallel: 1, items: [{ id: 'q2', position: 2 }], runs: [{}] },
      }),
    ).toBe('aip · run — q2 queued at position 2');
    expect(
      toolSummary('apply', {
        runId: 'r1',
        pending: false,
        groups: [
          { slug: 'a', delivery: { state: 'applied', reason: null, files: [], conflicts: [] } },
          { slug: 'b', delivery: { state: 'apply_failed', reason: 'x', files: [], conflicts: [] } },
        ],
      }),
    ).toBe('aip · apply — r1: 1 applied · 1 failed');
    expect(toolSummary('retry', active)).toBe('aip · retry — Add login (r1)');
    expect(toolSummary('group', { slug: 'a', status: 'failed' })).toBe('aip · group — a failed');
    expect(toolSummary('queue_start', { items: [1, 2], status: 'running' })).toBe(
      'aip · queue start — 2 queued, running',
    );
    expect(toolSummary('queue_parallel', { items: [1], status: 'running' })).toBe(
      'aip · queue parallel — 1 queued, running',
    );
    expect(toolSummary('apply', {})).toBeNull();
  });
});
