import { expect, test } from 'claude-code/testing';

import { group, legacyRun, run, runLine, snapshotLine } from './fixtures.ts';
import { PANE, ok, world } from './world.ts';

const SESSION = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const;
const SURFACES = ['terminal', 'desktop'] as const;
const ALL_SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const;
const SLOW = { timeoutMs: 60_000 };

function typed(command: string, args: string) {
  return {
    command,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  } as const;
}

test('a group row is updated live after an event', SLOW, async ($, on) => {
  const aip = world(on);
  await $.session.start(SESSION);
  await aip.clock.settle();
  await aip.send(snapshotLine([run('r1', [group('login', { step: 'code' })])]));

  for (const surface of ALL_SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect((await ui.find({ type: 'Text', text: /^step / }))?.text).toContain('step code');
    expect(await ui.find({ type: 'Text', text: /^◐ running · login/ })).toBeDefined();
    await aip.send(runLine(run('r1', [group('login', { step: 'review', round: 2 })])));
    const row = await ui.find({ type: 'Text', text: /^step / });
    expect(row?.text).toContain('step review');
    expect(row?.text).toContain('round 2');
    expect(await ui.find({ type: 'Text', text: /^r1 · feature · .*\$0\.0123$/ })).toBeDefined();
    await aip.send(runLine(run('r1', [group('login', { step: 'code' })])));
    await ui.unmount();
  }
  expect(aip.streams[0]?.argv).toEqual(['aip', 'events', '--json']);
  expect(aip.opened).toEqual([]);
});

test('an answer typed in the pane is sent to aip', SLOW, async ($, on) => {
  const aip = world(on);
  aip.answer((argv) => (argv[1] === 'group' && argv[2] === 'answer' ? ok('Run r1 …') : undefined));
  await $.session.start(SESSION);
  await aip.clock.settle();
  await aip.send(
    snapshotLine([run('r1', [group('login', { status: 'needs_human', question: 'OAuth?' })])]),
  );

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ type: 'Markdown', text: 'OAuth?' })).toBeDefined();
    await ui.input({ key: 'answer-input:r1/login', text: 'используй OAuth', kind: 'change' });
    await ui.press({ key: 'answer:r1/login' });
    expect(aip.runs.at(-1)).toEqual(['aip', 'group', 'answer', 'r1', 'login', 'используй OAuth']);
    expect(await ui.find({ type: 'Text', text: '✓ login: answered' })).toBeDefined();
    await ui.input({ key: 'answer-input:r1/login', text: 'и GitHub' });
    expect(aip.runs.at(-1)).toEqual(['aip', 'group', 'answer', 'r1', 'login', 'и GitHub']);
    await ui.unmount();
  }
});

test('an empty answer is not sent', SLOW, async ($, on) => {
  const aip = world(on);
  await $.session.start(SESSION);
  await aip.clock.settle();
  await aip.send(
    snapshotLine([run('r1', [group('login', { status: 'needs_human', question: 'Q' })])]),
  );
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'answer:r1/login' });
  expect(aip.runs).toEqual([]);
  expect(await ui.find({ type: 'Text', text: '✕ login: type an answer first' })).toBeDefined();
  await ui.unmount();
});

test('a failed action shows its reason and files in the pane', SLOW, async ($, on) => {
  const aip = world(on);
  const rejected = {
    runId: 'r1',
    pending: false,
    groups: [
      {
        slug: 'login',
        delivery: {
          state: 'apply_failed',
          reason: 'your uncommitted changes touch the same files',
          files: ['src/login.ts', 'src/auth.ts'],
          conflicts: [],
        },
      },
    ],
  };
  aip.answer((argv) =>
    argv[1] === 'run' && argv[2] === 'apply'
      ? { exitCode: 1, stdout: JSON.stringify(rejected) }
      : undefined,
  );
  aip.answer((argv) =>
    argv[1] === 'group' && argv[2] === 'retry'
      ? { exitCode: 1, stderr: 'aip: group login is not failed\n' }
      : undefined,
  );
  await $.session.start(SESSION);
  await aip.clock.settle();
  await aip.send(
    snapshotLine([
      run('r1', [group('login', { status: 'merged' }), group('signup', { status: 'failed' })]),
    ]),
  );

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface });
    await ui.press({ key: 'apply:r1/login' });
    expect(aip.runs.at(-1)).toEqual(['aip', 'run', 'apply', 'r1', 'login', '--json']);
    const shown = await ui.find({ type: 'Text', text: /apply failed/ });
    expect(shown?.text).toBe(
      '✕ login: apply failed: your uncommitted changes touch the same files (files: src/login.ts, src/auth.ts)',
    );
    expect(shown?.props.color).toBe('error');
    await ui.press({ key: 'retry:r1/signup' });
    expect(await ui.find({ type: 'Text', text: '✕ group login is not failed' })).toBeDefined();
    await ui.unmount();
  }
});

test('cancel and apply act on a whole run', SLOW, async ($, on) => {
  const aip = world(on);
  aip.answer((argv) =>
    argv[1] === 'run' && argv[2] === 'apply'
      ? ok(
          JSON.stringify({
            runId: 'r1',
            pending: false,
            groups: [
              {
                slug: 'login',
                delivery: { state: 'applied', reason: null, files: ['a.ts'], conflicts: [] },
              },
            ],
          }),
        )
      : undefined,
  );
  await $.session.start(SESSION);
  await aip.clock.settle();
  await aip.send(
    snapshotLine([
      run('r1', [group('login', { status: 'merged' }), group('signup', { status: 'running' })]),
    ]),
  );
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.press({ key: 'cancel:r1' });
  expect(aip.runs.at(-1)).toEqual(['aip', 'run', 'cancel', 'r1']);
  expect(await ui.find({ type: 'Text', text: '✓ run r1: cancelled' })).toBeDefined();
  await ui.press({ key: 'cancel:r1/signup' });
  expect(aip.runs.at(-1)).toEqual(['aip', 'group', 'cancel', 'r1', 'signup']);
  await ui.press({ key: 'apply:r1' });
  expect(aip.runs.at(-1)).toEqual(['aip', 'run', 'apply', 'r1', '--json']);
  expect(await ui.find({ type: 'Text', text: '✓ login: applied (files: a.ts)' })).toBeDefined();
  await ui.unmount();
});

test('another run is selected from the list', SLOW, async ($, on) => {
  const aip = world(on);
  await $.session.start(SESSION);
  await aip.clock.settle();
  await aip.send(
    snapshotLine([
      run('r2', [group('signup')]),
      run('r1', [group('login', { status: 'merged' })], { finished: true }),
    ]),
  );
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect(await ui.find({ type: 'Text', text: /· signup/ })).toBeDefined();
  await ui.press({ key: 'run:r1' });
  expect(await ui.find({ type: 'Text', text: /· login/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /· signup/ })).toBeUndefined();
  await ui.unmount();
});

test('the status line says idle when no run is active', SLOW, async ($, on) => {
  const aip = world(on);
  await $.session.start(SESSION);
  await aip.clock.settle();
  await aip.send(
    snapshotLine([
      run('r1', [group('a'), group('b'), group('c', { status: 'needs_human', question: 'Q' })]),
    ]),
  );
  expect(aip.statuses.at(-1)).toBe('aip: r1 · 2 running · 1 question');
  await aip.send(
    runLine(
      run('r1', [group('a', { status: 'merged' }), group('b', { status: 'cancelled' })], {
        finished: true,
      }),
    ),
  );
  expect(aip.statuses.at(-1)).toBe('aip: idle');
});

test('a new active run does not open the pane, only /aip:panel does', SLOW, async ($, on) => {
  const aip = world(on);
  await $.session.start(SESSION);
  await aip.clock.settle();
  await aip.send(snapshotLine([run('r1', [group('a')])]));
  await aip.send(runLine(run('r2', [group('b')])));
  expect(aip.opened).toEqual([]);
  expect((await $.command.run(typed('aip:panel', ''))).text).toBe('aip pane opened.');
  expect(aip.opened).toEqual(['aip']);
});

test('a question is toasted once, also after a reconnect', SLOW, async ($, on) => {
  const aip = world(on);
  aip.answer((argv) =>
    argv[1] === 'run' && argv[2] === 'list'
      ? { exitCode: 1, stderr: 'aip: daemon down' }
      : undefined,
  );
  await $.session.start(SESSION);
  await aip.clock.settle();
  await aip.send(snapshotLine([run('r1', [group('login')])]));
  expect(aip.toasts).toEqual([]);

  const asking = run('r1', [
    group('login', { status: 'needs_human', question: 'OAuth или пароль?\nдетали' }),
  ]);
  await aip.send(runLine(asking, 2));
  await aip.send(runLine(asking, 3));
  expect(aip.toasts).toEqual(['login · r1 asks: OAuth или пароль?']);

  await aip.close();
  await aip.clock.advance(5000);
  expect(aip.streams).toHaveLength(2);
  await aip.send(snapshotLine([asking], 1));
  expect(aip.toasts).toEqual(['login · r1 asks: OAuth или пароль?']);

  await aip.send(
    runLine(
      run('r1', [group('login', { status: 'failed', reason: 'boom' })], {
        finished: true,
        counts: '1 failed',
      }),
      2,
    ),
  );
  expect(aip.toasts).toEqual([
    'login · r1 asks: OAuth или пароль?',
    'login · r1 failed: boom',
    'run r1 (feature) finished: 1 failed',
  ]);
});

test('a lost stream falls back to polling and reconnects', SLOW, async ($, on) => {
  const aip = world(on);
  let polled = run('r1', [group('login', { step: 'code' })]);
  aip.answer((argv) =>
    argv[1] === 'run' && argv[2] === 'list' ? ok(JSON.stringify([polled])) : undefined,
  );
  await $.session.start(SESSION);
  await aip.clock.settle();
  await aip.send(snapshotLine([polled]));
  await aip.close();

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect(await ui.find({ type: 'Text', text: /polling every 2 s/ })).toBeDefined();
  polled = run('r1', [group('login', { step: 'review' })]);
  await aip.clock.advance(2000);
  expect(aip.runs).toEqual([['aip', 'run', 'list', '--json']]);
  expect((await ui.find({ type: 'Text', text: /^step / }))?.text).toContain('step review');

  await aip.clock.advance(3000);
  expect(aip.streams).toHaveLength(2);
  polled = run('r1', [group('login', { step: 'test' })]);
  await aip.send(snapshotLine([polled]));
  expect(await ui.find({ type: 'Text', text: /polling/ })).toBeUndefined();
  const polls = aip.runs.length;
  await aip.clock.advance(6000);
  expect(aip.runs).toHaveLength(polls);
  await aip.send(runLine(run('r1', [group('login', { step: 'merge' })])));
  expect((await ui.find({ type: 'Text', text: /^step / }))?.text).toContain('step merge');
  await ui.unmount();
});

test('a missing aip is shown in the pane and the status line', SLOW, async ($, on) => {
  const aip = world(on, { missing: true });
  await $.session.start(SESSION);
  await aip.clock.settle();
  expect(aip.statuses.at(-1)).toBe('aip: command not found, set the aipCommand option');
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  const shown = await ui.find({ type: 'Text', text: /cannot run `aip`/ });
  expect(shown?.text).toContain('aipCommand');
  expect(shown?.props.color).toBe('error');
  await ui.unmount();
});

test(
  'the aipCommand option is the command that runs aip',
  { options: { aipCommand: ['node', '/opt/aip/dist/cli/main.js'] } },
  async ($, on) => {
    const aip = world(on);
    await $.session.start(SESSION);
    await aip.clock.settle();
    expect(aip.lastStream().argv).toEqual([
      'node',
      '/opt/aip/dist/cli/main.js',
      'events',
      '--json',
    ]);
  },
);

test('/aip:run starts a workflow in the session repository', SLOW, async ($, on) => {
  const aip = world(on);
  aip.answer((argv) =>
    argv[1] === 'run' && argv[2] === 'start'
      ? ok(
          JSON.stringify({
            item: 'q1',
            run: {
              runId: 'r9',
              branch: 'aip/r9',
              groups: [{ slug: 'dobavit-vhod', title: 'добавить вход' }],
              split: false,
              warnings: [],
            },
            queue: { status: 'running', parallel: 1, items: [], runs: [{}] },
          }),
        )
      : undefined,
  );
  const result = await $.command.run(typed('aip:run', 'feature добавить вход'));
  expect(aip.runs.at(-1)).toEqual([
    'aip',
    'run',
    'start',
    'feature',
    '--task',
    'добавить вход',
    '--repo',
    '/repo',
    '--json',
  ]);
  expect(result.text).toBe('**r9** started on `aip/r9`\n\n- **dobavit-vhod** — добавить вход');
  expect((await $.command.run(typed('aip:run', 'feature'))).text).toBe(
    'Usage: /aip:run <workflow> <task>',
  );
});

test('/aip:run reports the queue position of a waiting task', SLOW, async ($, on) => {
  const aip = world(on);
  aip.answer((argv) =>
    argv[1] === 'run' && argv[2] === 'start'
      ? ok(
          JSON.stringify({
            item: 'q5',
            run: null,
            queue: {
              status: 'running',
              parallel: 1,
              items: [{ id: 'q5', position: 1 }],
              runs: [{}],
            },
          }),
        )
      : undefined,
  );
  const result = await $.command.run(typed('aip:run', 'feature добавить вход'));
  expect(result.text).toBe('**q5** queued at position 1 · 1 of 1 places taken');
});

test('/aip:status, /aip:apply and /aip:panel', SLOW, async ($, on) => {
  const aip = world(on);
  aip.answer((argv) =>
    argv[1] === 'run' && argv[2] === 'show' && argv[3] === 'nope'
      ? { exitCode: 1, stderr: 'aip: run nope not found\n' }
      : argv[1] === 'run' && (argv[2] === 'show' || argv[2] === 'list')
        ? ok(
            JSON.stringify(
              argv[3] === 'r1'
                ? run('r1', [group('login')], { title: 'Add login' })
                : [run('r1', [group('login')], { title: 'Add login' })],
            ),
          )
        : undefined,
  );
  aip.answer((argv) =>
    argv[1] === 'run' && argv[2] === 'apply'
      ? { exitCode: 1, stderr: 'aip: run r2 not found\n' }
      : undefined,
  );
  const list = (await $.command.run(typed('aip:status', ''))).text;
  expect(list).toContain('**Add login**');
  expect(list).toContain('`r1`');
  expect(list).toContain('0/1');
  expect(aip.runs.at(-1)).toEqual(['aip', 'run', 'list', '--json']);
  const one = (await $.command.run(typed('aip:status', 'r1'))).text;
  expect(one).toContain('### ◐ Add login · `r1`');
  expect(one).toContain('**login** running');
  expect(aip.runs.at(-1)).toEqual(['aip', 'run', 'show', 'r1', '--json']);
  expect((await $.command.run(typed('aip:status', 'nope'))).text).toBe('run nope not found');
  expect((await $.command.run(typed('aip:apply', 'r2 login --force'))).text).toBe(
    'run r2 not found',
  );
  expect(aip.runs.at(-1)).toEqual(['aip', 'run', 'apply', 'r2', 'login', '--force', '--json']);
  expect((await $.command.run(typed('aip:panel', ''))).text).toBe('aip pane opened.');
  expect(aip.opened).toEqual(['aip']);
  expect((await $.command.run(typed('aip:panel', 'close'))).text).toBe('aip pane closed.');
  expect(aip.closed).toEqual(['aip']);
  expect((await $.command.run(typed('aip:panel', 'hide'))).text).toBe('Usage: /aip:panel [close]');
});

test('a command shows a missing aip as text', SLOW, async ($, on) => {
  const aip = world(on);
  aip.answer(() => ({ deny: 'spawn aip ENOENT' }));
  const result = await $.command.run(typed('aip:status', ''));
  expect(result.text).toContain('cannot run `aip`');
  expect(result.text).toContain('aipCommand');
});

async function started(
  $: { session: { start: (session: typeof SESSION) => Promise<unknown> } },
  aip: ReturnType<typeof world>,
  runs: Parameters<typeof snapshotLine>[0],
) {
  await $.session.start(SESSION);
  await aip.clock.settle();
  await aip.send(snapshotLine(runs));
}

test('the run title is shown instead of the id, with progress', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [
    run(
      'r1',
      [
        group('a', { status: 'merged' }),
        group('b', { status: 'merged' }),
        group('c', { status: 'merged' }),
        group('d'),
        group('e'),
      ],
      { title: 'Add login' },
    ),
    run('r2', [group('x')]),
  ]);
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface });
    const row = await ui.find({ type: 'Button', key: 'run:r1' });
    expect(row?.text).toContain('Add login');
    expect(row?.text).toContain('▰▰▰▰▰▰▱▱▱▱ 3/5');
    expect((await ui.find({ type: 'Button', key: 'run:r2' }))?.text).toContain('r2');
    expect(await ui.find({ type: 'Text', text: /^aip · 2 active/ })).toBeDefined();
    await ui.unmount();
  }
});

test('runs are numbered, a key selects one, the rest is folded', SLOW, async ($, on) => {
  const aip = world(on);
  await started(
    $,
    aip,
    Array.from({ length: 11 }, (_, index) =>
      run(`r${index}`, [group(`g${index}`, { status: 'merged' })], {
        finished: index < 9,
        createdAt: index,
      }),
    ),
  );
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect((await ui.find({ type: 'Button', key: 'run:r10' }))?.props.hotkey).toBe('1');
  expect((await ui.find({ type: 'Button', key: 'run:r9' }))?.props.hotkey).toBe('2');
  expect(await ui.find({ type: 'Text', text: '+3 more' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'run:r0' })).toBeUndefined();
  // The test API presses a button by its key only, not by a typed hotkey, so the hotkey is
  // checked through the `hotkey` prop above and the selection through the button's key.
  await ui.press({ key: 'run:r9' });
  expect(await ui.find({ type: 'Text', text: /^r10 · feature/ })).toBeUndefined();
  expect(await ui.find({ type: 'Text', text: /^r9 · feature/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /· g9$|· g9 / })).toBeDefined();
  await ui.unmount();
});

test('a failed group has a symbol and a theme colour', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [run('r1', [group('signup', { status: 'failed', reason: 'boom' })])]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  const line = await ui.find({ type: 'Text', text: /^✕ failed · signup/ });
  expect(line?.props.color).toBe('error');
  expect(line?.props.wrap).toBe('truncate-end');
  await ui.unmount();
});

test('a narrow window drops the diff and the delivery', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [
    run('r1', [group('login', { status: 'merged', diff: { files: 2, added: 5, removed: 1 } })]),
  ]);
  const wide = await $.ui.mount({
    ...PANE,
    surface: 'terminal',
    viewport: { columns: 140, rows: 40 },
  });
  const full = await wide.find({ type: 'Text', text: /^step / });
  expect(full?.text).toContain('2 files +5 −1');
  expect(full?.text).toContain('not applied');
  await wide.unmount();
  const narrow = await $.ui.mount({
    ...PANE,
    surface: 'terminal',
    viewport: { columns: 80, rows: 40 },
  });
  const short = await narrow.find({ type: 'Text', text: /^● login · code/ });
  expect(short?.text).toContain('login · code');
  expect(short?.text).not.toContain('files');
  expect(short?.text).not.toContain('applied');
  expect(await narrow.find({ type: 'Text', text: /^step / })).toBeUndefined();
  const row = await narrow.find({ type: 'Button', key: 'run:r1' });
  expect(row?.text).not.toContain('$');
  expect(row?.text).not.toContain('▰');
  await narrow.unmount();
});

test('a question of another run is listed under Needs you', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [
    run('r1', [group('login', { status: 'needs_human', question: 'OAuth?' })], {
      title: 'Add login',
      createdAt: 1,
    }),
    run('r2', [group('signup')], { createdAt: 2 }),
  ]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect(await ui.find({ type: 'Text', text: 'Needs you' })).toBeDefined();
  expect((await ui.find({ type: 'Button', key: 'attention:r1/login' }))?.text).toBe(
    'login · Add login — OAuth?',
  );
  expect(await ui.find({ type: 'Button', key: 'answer:r1/login' })).toBeUndefined();
  await ui.press({ key: 'attention:r1/login' });
  expect(await ui.find({ type: 'Button', key: 'answer:r1/login' })).toBeDefined();
  await ui.unmount();
});

test('nothing to decide hides the Needs you strip', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [run('r1', [group('login')])]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect(await ui.find({ type: 'Text', text: 'Needs you' })).toBeUndefined();
  await ui.unmount();
});

const ASKING = run('r1', [
  group('login', {
    status: 'needs_human',
    question: 'Auth?',
    questions: [{ text: 'Auth?', options: ['OAuth', 'Password'], recommendation: 'OAuth' }],
  }),
]);

test('an option is chosen with a button and sent as Q/A text', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [ASKING]);
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect((await ui.find({ type: 'Button', key: 'option:r1/login/q1/0' }))?.text).toContain(
      'recommended',
    );
    expect(await ui.find({ type: 'Button', key: 'option:r1/login/q1/1' })).toBeDefined();
    await ui.press({ key: 'option:r1/login/q1/1' });
    await ui.press({ key: 'answer:r1/login' });
    expect(aip.runs.at(-1)).toEqual([
      'aip',
      'group',
      'answer',
      'r1',
      'login',
      'Q1: Auth?\nA1: Password',
    ]);
    await ui.unmount();
  }
});

test('the recommendation is the default answer', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [ASKING]);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect((await ui.find({ type: 'Input', key: 'answer-input:r1/login/q1' }))?.props.value).toBe(
    'OAuth',
  );
  await ui.press({ key: 'answer:r1/login' });
  expect(aip.runs.at(-1)).toEqual([
    'aip',
    'group',
    'answer',
    'r1',
    'login',
    'Q1: Auth?\nA1: OAuth',
  ]);
  await ui.unmount();
});

test('an incomplete answer is not sent', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [
    run('r1', [
      group('login', {
        status: 'needs_human',
        question: 'Q',
        questions: [{ text: 'One?' }, { text: 'Two?' }],
      }),
    ]),
  ]);
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  await ui.input({ key: 'answer-input:r1/login/q1', text: 'yes', kind: 'change' });
  await ui.press({ key: 'answer:r1/login' });
  expect(aip.runs).toEqual([]);
  expect(await ui.find({ type: 'Text', text: '✕ login: answer question 2 first' })).toBeDefined();
  await ui.input({ key: 'answer-input:r1/login/q2', text: 'no' });
  expect(aip.runs.at(-1)).toEqual([
    'aip',
    'group',
    'answer',
    'r1',
    'login',
    'Q1: One?\nA1: yes\n\nQ2: Two?\nA2: no',
  ]);
  await ui.unmount();
});

test('a success line disappears after 8 seconds, an error stays', SLOW, async ($, on) => {
  const aip = world(on);
  aip.answer((argv) =>
    argv[1] === 'group' && argv[2] === 'retry' && argv[4] === 'bad'
      ? { exitCode: 1, stderr: 'aip: no\n' }
      : undefined,
  );
  await started($, aip, [
    run('r1', [group('signup', { status: 'failed' }), group('bad', { status: 'failed' })]),
  ]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  await ui.press({ key: 'retry:r1/signup' });
  expect(await ui.find({ type: 'Text', text: '✓ signup: retried' })).toBeDefined();
  await aip.clock.advance(7000);
  expect(await ui.find({ type: 'Text', text: '✓ signup: retried' })).toBeDefined();
  await aip.clock.advance(1500);
  expect(await ui.find({ type: 'Text', text: /signup: retried/ })).toBeUndefined();
  await ui.press({ key: 'retry:r1/bad' });
  await aip.clock.advance(20_000);
  expect(await ui.find({ type: 'Text', text: '✕ no' })).toBeDefined();
  await ui.unmount();
});

test('a double press runs the action once', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [run('r1', [group('login', { status: 'merged' })], { finished: true })]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  await Promise.all([ui.press({ key: 'apply:r1' }), ui.press({ key: 'apply:r1' })]);
  expect(aip.runs.filter((argv) => argv[1] === 'run' && argv[2] === 'apply')).toHaveLength(1);
  await ui.unmount();
});

test('a running action shows … on its button', SLOW, async ($, on) => {
  const aip = world(on);
  const release = aip.hold((argv) => argv[1] === 'run' && argv[2] === 'apply');
  await started($, aip, [run('r1', [group('login', { status: 'merged' })], { finished: true })]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect((await ui.find({ type: 'Button', key: 'apply:r1' }))?.text).toContain('apply run');
  const pressed = ui.press({ key: 'apply:r1' });
  await aip.clock.settle();
  expect((await ui.find({ type: 'Button', key: 'apply:r1' }))?.text).toContain('…');
  release();
  await pressed;
  await aip.clock.settle();
  expect((await ui.find({ type: 'Button', key: 'apply:r1' }))?.text).toContain('apply run');
  await ui.unmount();
});

test('the split step shows its structured questions as buttons', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [
    run('r1', [], {
      split: {
        status: 'needs_human',
        question: 'Scope?',
        questions: [{ text: 'Scope?', options: ['Small', 'Large'] }],
        reason: null,
      },
    } as never),
  ]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect(await ui.find({ type: 'Button', key: 'option:r1/_split/q1/0' })).toBeDefined();
  await ui.press({ key: 'option:r1/_split/q1/1' });
  await ui.press({ key: 'answer:r1/_split' });
  expect(aip.runs.at(-1)).toEqual([
    'aip',
    'group',
    'answer',
    'r1',
    '_split',
    'Q1: Scope?\nA1: Large',
  ]);
  await ui.unmount();
});

test('a failed delivery in swarm_apply is a red cross', SLOW, async ($, on) => {
  world(on);
  standard(on);
  const output = STATUS_OUTPUT({
    runId: 'r1',
    pending: false,
    groups: [
      { slug: 'a', delivery: { state: 'applied', reason: null, files: [], conflicts: [] } },
      { slug: 'b', delivery: { state: 'pending', reason: null, files: [], conflicts: [] } },
      { slug: 'c', delivery: { state: 'apply_failed', reason: 'x', files: [], conflicts: [] } },
    ],
  });
  const ui = await $.ui.mount({
    ...RESULT,
    surface: 'terminal',
    props: { ...RESULT.props, tool: 'mcp__aip__swarm_apply', output },
  });
  expect(await ui.find({ type: 'Text', text: '✕' })).toBeDefined();
  expect(
    await ui.find({ type: 'Text', text: 'aip · apply — r1: 1 applied · 1 failed' }),
  ).toBeDefined();
  await ui.unmount();
});

test('a daemon without the new fields still draws', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [legacyRun('r1')]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect((await ui.find({ type: 'Button', key: 'run:r1' }))?.text).toContain('r1');
  await ui.unmount();
});

// The engine's own drawing, beneath the plugin: what a row looks like without the mod.
function standard(on: Parameters<typeof world>[0]): void {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>standard row</Text>;
  });
}

const STATUS_OUTPUT = (data: unknown) => [
  { type: 'text', text: `summary\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`` },
];
const RESULT = {
  plugin: 'aip',
  component: 'ToolResult',
  props: {
    tool_use_id: 't1',
    tool: 'mcp__aip__swarm_status',
    isErrored: false,
    isExpanded: false,
    output: STATUS_OUTPUT([
      run(
        'r1',
        [
          group('a', { status: 'merged' }),
          group('b', { status: 'merged' }),
          group('c', { status: 'merged' }),
          group('d'),
          group('e', { status: 'needs_human', question: 'Q' }),
        ],
        { title: 'Add login', waiting: 1 },
      ),
    ]),
  },
} as const;
const SUMMARY = 'aip · status — 1 active: Add login 3/5 · 1 needs answer';

test('a collapsed swarm_status is one line', SLOW, async ($, on) => {
  world(on);
  standard(on);
  for (const surface of ALL_SURFACES) {
    const ui = await $.ui.mount({ ...RESULT, surface });
    expect(await ui.find({ type: 'Text', text: SUMMARY })).toBeDefined();
    await ui.unmount();
  }
});

test(
  'the tool row keeps the standard drawing when expanded, failed or foreign',
  SLOW,
  async ($, on) => {
    world(on);
    standard(on);
    const cases = [
      { ...RESULT.props, isExpanded: true },
      { ...RESULT.props, isErrored: true },
      { ...RESULT.props, output: 'no json here' },
      { ...RESULT.props, tool: 'mcp__aip__swarm_nothing' },
      { ...RESULT.props, tool: 'Bash' },
    ];
    for (const props of cases) {
      const ui = await $.ui.mount({ ...RESULT, surface: 'terminal', props });
      expect(await ui.find({ type: 'Text', text: /^aip · / })).toBeUndefined();
      expect(await ui.find({ type: 'Text', text: 'standard row' })).toBeDefined();
      await ui.unmount();
    }
  },
);

test('the call row is a short title without the raw input', SLOW, async ($, on) => {
  world(on);
  standard(on);
  const props = {
    tool_use_id: 't1',
    tool: 'mcp__aip__swarm_retry',
    input: { run_id: 'r1', group: 'login' },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
  };
  const ui = await $.ui.mount({ plugin: 'aip', component: 'ToolUse', surface: 'terminal', props });
  expect(await ui.find({ type: 'Text', text: 'aip · retry r1/login' })).toBeDefined();
  await ui.unmount();
  const failed = await $.ui.mount({
    plugin: 'aip',
    component: 'ToolUse',
    surface: 'terminal',
    props: { ...props, isErrored: true },
  });
  expect(await failed.find({ type: 'Text', text: /^aip · / })).toBeUndefined();
  expect(await failed.find({ type: 'Text', text: 'standard row' })).toBeDefined();
  await failed.unmount();
});

const QUESTION = { status: 'needs_human', question: 'Auth?' } as const;

test('the selected run is marked in the list', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [
    run('r2', [group('signup')], { createdAt: 2 }),
    run('r1', [group('login')], { createdAt: 1 }),
  ]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  // Exactly one run carries the mark, and it follows the selection (the card below it).
  expect(await ui.findAll({ type: 'Text', text: '›' })).toHaveLength(1);
  expect(await ui.find({ type: 'Text', text: /· signup/ })).toBeDefined();
  await ui.press({ key: 'run:r1' });
  expect(await ui.findAll({ type: 'Text', text: '›' })).toHaveLength(1);
  expect(await ui.find({ type: 'Text', text: /· login/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /· signup/ })).toBeUndefined();
  await ui.unmount();
});

test("the selected run's question is answered at the top", SLOW, async ($, on) => {
  const aip = world(on);
  aip.answer((argv) => (argv[1] === 'group' && argv[2] === 'answer' ? ok('Run r1 …') : undefined));
  const groups = Array.from({ length: 7 }, (_, index) => group(`g${index}`));
  await started($, aip, [run('r1', [...groups, group('qa', QUESTION)])]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect(await ui.find({ type: 'Input', key: 'answer-input:r1/qa' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'answer:r1/qa' })).toBeDefined();
  expect(await ui.findAll({ type: 'Button', key: 'answer:r1/qa' })).toHaveLength(1);
  await ui.input({ key: 'answer-input:r1/qa', text: 'OAuth', kind: 'change' });
  await ui.press({ key: 'answer:r1/qa' });
  expect(aip.runs.at(-1)).toEqual(['aip', 'group', 'answer', 'r1', 'qa', 'OAuth']);
  await ui.unmount();
});

test('only fitting actions per status', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [
    run('r1', [
      group('q', { status: 'queued' }),
      group('r', { status: 'running' }),
      group('f', { status: 'failed', reason: 'boom' }),
      group('c', { status: 'conflict' }),
      group('m', { status: 'merged', delivery: 'pending' }),
      group('d', { status: 'merged', delivery: 'applied' }),
      group('x', { status: 'cancelled' }),
    ]),
  ]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  const keys = async () =>
    (await ui.findAll({ type: 'Button' }))
      .map((button) => button.key as string)
      .filter((key) => /^(retry|cancel|apply|answer):/.test(key))
      .sort();
  expect(await keys()).toEqual(
    [
      'apply:r1',
      'apply:r1/m',
      'cancel:r1',
      'cancel:r1/c',
      'cancel:r1/q',
      'cancel:r1/r',
      'retry:r1/c',
      'retry:r1/f',
    ].sort(),
  );
  await ui.unmount();
});

test('a single-group run has run actions only', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [run('r1', [group('login')])]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect(await ui.find({ type: 'Button', key: 'cancel:r1' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'cancel:r1/login' })).toBeUndefined();
  await ui.unmount();
});

test('groups are ordered by urgency', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [
    run('r1', [
      group('done', { status: 'merged' }),
      group('busy', { status: 'running' }),
      group('broken', { status: 'failed' }),
    ]),
  ]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  const lines = (await ui.findAll({ type: 'Text', text: /^[●◐✕] (merged|running|failed) · / })).map(
    (line) => line.text as string,
  );
  expect(lines.map((line) => line.split(' · ')[1])).toEqual(['broken', 'busy', 'done']);
  await ui.unmount();
});

test('a narrow pane keeps questions open', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [
    run('r1', [
      group('login', {
        status: 'needs_human',
        question: 'Auth?',
        questions: [{ text: 'Auth?', options: ['OAuth', 'Password'] }],
      }),
    ]),
  ]);
  const ui = await $.ui.mount({
    ...PANE,
    surface: 'terminal',
    viewport: { columns: 80, rows: 40 },
  });
  expect(await ui.find({ type: 'Markdown', text: /Auth\?/ })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'option:r1/login/q1/0' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'option:r1/login/q1/1' })).toBeDefined();
  expect(await ui.find({ type: 'Button', key: 'answer:r1/login' })).toBeDefined();
  await ui.unmount();
});

test('an action error is shown under the header', SLOW, async ($, on) => {
  const aip = world(on);
  aip.answer((argv) =>
    argv[1] === 'group' && argv[2] === 'retry'
      ? { exitCode: 1, stderr: 'aip: group a is not failed\n' }
      : undefined,
  );
  await started($, aip, [run('r1', [group('a', { status: 'failed' }), group('b')])]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  await ui.press({ key: 'retry:r1/a' });
  const shown = await ui.find({ type: 'Text', text: /^✕ group a is not failed/ });
  expect(shown?.props.color).toBe('error');
  await ui.unmount();
});

test('one status looks the same everywhere', SLOW, async ($, on) => {
  const aip = world(on);
  await started($, aip, [
    run('r1', [group('login', QUESTION), group('other')], { createdAt: 1 }),
    run('r2', [group('x')], { createdAt: 2 }),
  ]);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  // r2 is selected, so the r1 question is a row; select r1 to see its group row as well
  const item = await ui.find({ type: 'Text', text: '?' });
  expect(item?.props.color).toBe('warning');
  const rowIcon = (await ui.findAll({ type: 'Text', text: '?' })).map((text) => text.props.color);
  expect(rowIcon.every((color) => color === 'warning')).toBe(true);
  await ui.press({ key: 'run:r1' });
  const line = await ui.find({ type: 'Text', text: /^\? needs you · login/ });
  expect(line?.props.color).toBe('warning');
  const mark = (await ui.findAll({ type: 'Text', text: '?' })).map((text) => text.props.color);
  expect(mark.length).toBeGreaterThan(0);
  expect(mark.every((color) => color === 'warning')).toBe(true);
  await ui.unmount();
});
