import { describe, expect, it } from 'vitest';

import { formatWebStatus, webStatusView } from '../../src/presentation/cli/web-control.ts';
import type { WebStatusResult } from '../../src/presentation/ipc/contract/index.ts';

const running: WebStatusResult = {
  running: true,
  host: '127.0.0.1',
  port: 7341,
  auth: 'token',
  url: 'http://127.0.0.1:7341/?token=abc',
  reason: null,
  stopped: false,
};

describe('webStatusView', () => {
  it('describes a running panel with the pid of the daemon', () => {
    const view = webStatusView({ pong: true, pid: 42 }, running);
    expect(view).toEqual({
      running: true,
      pid: 42,
      url: running.url,
      host: '127.0.0.1',
      port: 7341,
      auth: 'token',
      daemon: true,
      reason: null,
    });
    expect(formatWebStatus(view)).toBe(
      [
        'aip web: running (pid 42)',
        `url: ${running.url}`,
        'address: 127.0.0.1:7341',
        'auth: token',
      ].join('\n'),
    );
  });

  it('describes a stopped panel with the reason', () => {
    const view = webStatusView(
      { pong: true, pid: 42 },
      {
        ...running,
        running: false,
        host: null,
        port: null,
        auth: null,
        url: null,
        reason: 'port 127.0.0.1:7341 is already in use',
      },
    );
    expect(view).toMatchObject({ running: false, pid: null, url: null, daemon: true });
    expect(formatWebStatus(view)).toBe(
      'aip web: not running\nreason: port 127.0.0.1:7341 is already in use',
    );
  });

  it('describes the absence of a daemon', () => {
    const view = webStatusView(null, null);
    expect(view).toEqual({
      running: false,
      pid: null,
      url: null,
      host: null,
      port: null,
      auth: null,
      daemon: false,
      reason: null,
    });
    expect(formatWebStatus(view)).toBe('aip web: not running');
    expect(JSON.stringify(view)).not.toContain('\n');
  });
});
