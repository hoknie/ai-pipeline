import { expect, test } from 'claude-code/testing';

import { world } from './world.ts';

const SLOW = { timeoutMs: 60_000 };
const URL_1 = 'http://127.0.0.1:7341/?token=t1';
const URL_2 = 'http://127.0.0.1:8080/?token=t2';

function typed(args: string) {
  return {
    command: 'aip:web',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  } as const;
}

test('/aip:web starts the server and answers with the link', SLOW, async ($, on) => {
  const aip = world(on);
  const pending = $.command.run(typed(''));
  await aip.clock.settle();
  expect(aip.streamOf('web').argv).toEqual(['aip', 'web']);
  await aip.send('aip web: http://127.0.0.1:73');
  await aip.send('41/?token=t1\nPress Ctrl+C to stop.\n');
  expect((await pending).text).toBe(`aip web: ${URL_1}`);
});

test('a second start does not start another process', SLOW, async ($, on) => {
  const aip = world(on);
  const first = $.command.run(typed('start'));
  await aip.clock.settle();
  await aip.send(`aip web: ${URL_1}\n`);
  await first;
  expect((await $.command.run(typed('start'))).text).toBe(`aip web: ${URL_1}`);
  expect(aip.streams).toHaveLength(1);
  expect((await $.command.run(typed('status'))).text).toBe(`aip web: ${URL_1}`);
});

test('stop kills the process, status then says it is not running', SLOW, async ($, on) => {
  const aip = world(on);
  expect((await $.command.run(typed('stop'))).text).toBe('aip web is not running.');
  const pending = $.command.run(typed(''));
  await aip.clock.settle();
  await aip.send(`aip web: ${URL_1}\n`);
  await pending;
  expect((await $.command.run(typed('stop'))).text).toBe('aip web stopped.');
  if (!aip.streamOf('web').killed) {
    throw new Error(`the process was not killed; hook args: ${aip.streamOf('web').shape}`);
  }
  expect((await $.command.run(typed('status'))).text).toBe('aip web is not running.');
  expect(aip.toasts).toEqual([]);
});

test('restart keeps the port and stops the old process first', SLOW, async ($, on) => {
  const aip = world(on);
  const first = $.command.run(typed('--port 8080'));
  await aip.clock.settle();
  await aip.send(`aip web: http://127.0.0.1:8080/?token=t1\n`);
  await first;
  const old = aip.streamOf('web');
  const second = $.command.run(typed('restart'));
  await aip.clock.settle();
  expect(old.killed).toBe(true);
  expect(aip.streams).toHaveLength(2);
  expect(aip.streamOf('web').argv).toEqual(['aip', 'web', '--port', '8080']);
  await aip.send(`aip web: ${URL_2}\n`);
  expect((await second).text).toBe(`aip web: ${URL_2}`);
});

test('a busy port is shown as an error', SLOW, async ($, on) => {
  const aip = world(on);
  const pending = $.command.run(typed(''));
  await aip.clock.settle();
  aip.streamOf('web').writeErr('aip: listen EADDRINUSE: address already in use 127.0.0.1:7341\n');
  aip.streamOf('web').end(1);
  const result = await pending;
  expect(result.text).toContain('EADDRINUSE');
  expect((await $.command.run(typed('status'))).text).toBe('aip web is not running.');
});

test('no link in 30 seconds is an error and the process is killed', SLOW, async ($, on) => {
  const aip = world(on);
  const pending = $.command.run(typed(''));
  await aip.clock.settle();
  await aip.clock.advance(30_000);
  expect((await pending).text).toContain('did not print a link');
  expect(aip.streamOf('web').killed).toBe(true);
});

test('a missing aip is reported with the aipCommand hint', SLOW, async ($, on) => {
  world(on, { missing: true });
  const result = await $.command.run(typed(''));
  expect(result.text).toContain('cannot run `aip`');
  expect(result.text).toContain('ENOENT');
  expect(result.text).toContain('aipCommand');
});

test('a process that dies by itself raises one toast', SLOW, async ($, on) => {
  const aip = world(on);
  const pending = $.command.run(typed(''));
  await aip.clock.settle();
  await aip.send(`aip web: ${URL_1}\n`);
  await pending;
  aip.streamOf('web').writeErr('aip: daemon lost\n');
  aip.streamOf('web').end(1);
  await aip.clock.settle();
  expect(aip.toasts).toEqual(['aip web stopped: daemon lost']);
  expect((await $.command.run(typed('status'))).text).toBe('aip web is not running.');
});

test('the server stops when the session ends', SLOW, async ($, on) => {
  const aip = world(on);
  on('session.end', () => ({ sessionId: 's1' }) as never);
  const pending = $.command.run(typed(''));
  await aip.clock.settle();
  await aip.send(`aip web: ${URL_1}\n`);
  await pending;
  await $.session.end({ reason: 'exit' });
  expect(aip.streamOf('web').killed).toBe(true);
});

test('a wrong argument shows the usage', SLOW, async ($, on) => {
  const aip = world(on);
  expect((await $.command.run(typed('reboot'))).text).toBe(
    'Usage: /aip:web [start|stop|restart|status] [--port <n>]',
  );
  expect(aip.streams).toHaveLength(0);
});

test(
  'the aipCommand option is used for the web server',
  { ...SLOW, options: { aipCommand: ['node', '/opt/aip/dist/cli/main.js'] } },
  async ($, on) => {
    const aip = world(on);
    const pending = $.command.run(typed('--port 9000'));
    await aip.clock.settle();
    expect(aip.streamOf('web').argv).toEqual([
      'node',
      '/opt/aip/dist/cli/main.js',
      'web',
      '--port',
      '9000',
    ]);
    await aip.send(`aip web: ${URL_1}\n`);
    await pending;
  },
);

test(
  'a panel served by the daemon: start and status answer with its link, stop explains',
  SLOW,
  async ($, on) => {
    const aip = world(on);
    const pending = $.command.run(typed(''));
    await aip.clock.settle();
    await aip.send(`aip web: ${URL_1}\naip web: served by the aip daemon (pid 42)\n`);
    aip.streamOf('web').end(0);
    expect((await pending).text).toBe(`aip web: ${URL_1}`);
    expect((await $.command.run(typed('status'))).text).toBe(`aip web: ${URL_1}`);
    expect(aip.toasts).toEqual([]);
    expect((await $.command.run(typed('stop'))).text).toContain('belongs to the aip daemon');
    expect((await $.command.run(typed('status'))).text).toBe('aip web is not running.');
  },
);
