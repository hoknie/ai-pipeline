import { afterEach, describe, expect, it } from 'vitest';

import type { PanelControl } from '../../src/presentation/ipc/contract/index.ts';
import {
  webStartResultSchema,
  webStatusResultSchema,
  webStopResultSchema,
  type WebStatusResult,
} from '../../src/presentation/ipc/contract/index.ts';

import { harness, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

const running: WebStatusResult = {
  running: true,
  host: '127.0.0.1',
  port: 7341,
  auth: 'token',
  url: 'http://127.0.0.1:7341/?token=abcdefghijklmnop1234',
  reason: null,
  stopped: false,
};

describe('web panel control', () => {
  it('hands web_status, web_start and web_stop to the controller', async () => {
    const calls: string[] = [];
    const panel: PanelControl = {
      status: () => {
        calls.push('status');
        return running;
      },
      start: (options) => {
        calls.push(`start ${JSON.stringify(options)}`);
        return Promise.resolve({ state: 'restarted', status: running });
      },
      stop: () => {
        calls.push('stop');
        return Promise.resolve({ state: 'stopped' });
      },
    };
    const h = (current = await harness(undefined, {}, { panel }));
    expect(webStatusResultSchema.parse(await h.call('web_status', {}))).toEqual(running);
    const started = webStartResultSchema.parse(
      await h.call('web_start', { token: 'abcdefghijklmnop1234', restart: true }),
    );
    expect(started.state).toBe('restarted');
    expect(webStopResultSchema.parse(await h.call('web_stop', {}))).toEqual({ state: 'stopped' });
    expect(calls).toEqual([
      'status',
      'start {"token":"abcdefghijklmnop1234","restart":true}',
      'stop',
    ]);
  });

  it('refuses start and stop without a controller and reports no panel in the status', async () => {
    const h = (current = await harness());
    await expect(h.call('web_start', {})).rejects.toThrow('this daemon serves no web panel');
    await expect(h.call('web_stop', {})).rejects.toThrow('this daemon serves no web panel');
    const status = webStatusResultSchema.parse(await h.call('web_status', {}));
    expect(status).toMatchObject({
      running: false,
      reason: 'this daemon serves no web panel',
    });
  });

  it('passes a controller error to the client', async () => {
    const panel: PanelControl = {
      status: () => running,
      start: () => Promise.reject(new Error('port 127.0.0.1:1 is already in use')),
      stop: () => Promise.resolve({ state: 'not_running' }),
    };
    const h = (current = await harness(undefined, {}, { panel }));
    await expect(h.call('web_start', {})).rejects.toThrow('already in use');
  });
});
