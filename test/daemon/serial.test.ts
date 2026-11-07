import { afterEach, describe, expect, it } from 'vitest';

import { harness, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

describe('serial processing', () => {
  it('runs the jobs one after another in the order of the calls', async () => {
    const h = (current = await harness());
    const daemon = h.running.application.services.runs.engine;
    const log: string[] = [];
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const first = daemon.serial(async () => {
      log.push('a:start');
      await pause(40);
      log.push('a:end');
      return 1;
    });
    const second = daemon.serial(async () => {
      log.push('b:start');
      await pause(5);
      log.push('b:end');
      return 2;
    });
    const third = daemon.serial(() => {
      log.push('c');
      return Promise.resolve(3);
    });
    expect(await Promise.all([first, second, third])).toEqual([1, 2, 3]);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c']);
  });

  it('goes on after a failed job and hands its error to the caller', async () => {
    const h = (current = await harness());
    const daemon = h.running.application.services.runs.engine;
    const failed = daemon.serial(() => Promise.reject(new Error('boom')));
    const next = daemon.serial(() => Promise.resolve('ok'));
    await expect(failed).rejects.toThrow('boom');
    expect(await next).toBe('ok');
  });

  it('on stop waits for the job under way before it closes the database', async () => {
    const h = (current = await harness());
    const daemon = h.running.application.services.runs.engine;
    const log: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const job = daemon.serial(async () => {
      log.push('job:start');
      await gate;
      log.push('job:end');
    });
    const stopped = h.close().then(() => log.push('stopped'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(log).toEqual(['job:start']);
    release();
    await job;
    await stopped;
    expect(log).toEqual(['job:start', 'job:end', 'stopped']);
  });
});
