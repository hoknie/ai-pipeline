import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DUPLICATE_TASK_CODE } from '../../src/feature/queue/types/index.ts';
import type { QueueView, RunQueued } from '../../src/presentation/ipc/contract/index.ts';
import type { IpcError } from '../../src/presentation/ipc/client/index.ts';
import type { Harness } from './harness.ts';
import { queueOf, start, waitQueue } from './queue-harness.ts';

const LOGIN = { pipeline: 'feature', task: 'fix the login' };

const addTask = async (h: Harness, extra: Record<string, unknown> = {}) =>
  (await h.call('queue_add', { repository: h.repo, ...LOGIN, ...extra })) as QueueView & {
    item: string;
  };

const refusalOf = (view: QueueView, id: string): string =>
  `task #${view.items.find((item) => item.id === id)?.number} (${id}) with the same pipeline and task already waits in the queue`;

describe('a copy of a waiting task', () => {
  it('is refused with the number and the id of the waiting task, and the queue stays', async () => {
    const h = await start();
    const model = await addTask(h, { task: 'model' });
    const first = await addTask(h, { title: 'Login', after: [model.item] });
    const error = (await addTask(h, { title: 'Again' }).catch(
      (caught: unknown) => caught,
    )) as IpcError;
    expect(error.message).toBe(refusalOf(first, first.item));
    expect(error.remoteCode).toBe(DUPLICATE_TASK_CODE);
    // the spaces around the text make no other task
    await expect(addTask(h, { task: ' fix the login\n' })).rejects.toThrow('already waits');
    expect((await queueOf(h)).items.map((item) => item.id)).toEqual([model.item, first.item]);
  });

  it('takes the same text on another variant, and the same groups only once', async () => {
    const h = await start();
    await addTask(h);
    await expect(addTask(h, { variant: 'nope' })).rejects.toThrow('variant');
    const groups = [
      { title: 'login form', task: 'make it' },
      { title: 'signup form', task: 'make it too' },
    ];
    const forms = { task: undefined, groups };
    await addTask(h, forms);
    await expect(addTask(h, forms)).rejects.toThrow('already waits');
    await addTask(h, { task: undefined, groups: [...groups].reverse() });
    expect((await queueOf(h)).items).toHaveLength(3);
  });

  it('is added when it is asked for', async () => {
    const h = await start();
    const first = await addTask(h);
    const second = await addTask(h, { allowDuplicate: true });
    const items = (await queueOf(h)).items;
    expect(items.map((item) => item.id)).toEqual([first.item, second.item]);
    expect(items.map((item) => item.number)).toEqual([1, 2]);
  });

  it('stores no attachment of a refused task', async () => {
    const h = await start();
    await addTask(h);
    const source = join(h.state, 'note.txt');
    writeFileSync(source, 'note');
    await expect(addTask(h, { attachments: [{ path: source }] })).rejects.toThrow('already waits');
    const root = join(h.state, 'attachments');
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
  });

  it('refuses a run request too and does not start the stopped queue', async () => {
    const h = await start();
    const first = await addTask(h);
    await expect(h.call('run', { repository: h.repo, ...LOGIN })).rejects.toThrow(
      refusalOf(first, first.item),
    );
    const view = await queueOf(h);
    expect(view.status).toBe('stopped');
    expect(view.items).toHaveLength(1);
    h.script({ code: [{ waitFor: h.gate('a') }] });
    const queued = (await h.call('run', {
      repository: h.repo,
      ...LOGIN,
      allowDuplicate: true,
    })) as RunQueued;
    expect(queued.queue.status).toBe('running');
    h.open('a');
  });

  it('does not compare a task that became a run', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('a') }] });
    await addTask(h);
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.runs.length === 1 && queue.items.length === 0);
    const again = await addTask(h);
    expect(again.item).toBeTruthy();
    h.open('a');
  });

  it('lets an edit make a task a copy of another one', async () => {
    const h = await start();
    await addTask(h);
    const other = await addTask(h, { task: 'another text' });
    await h.call('queue_edit', { repository: h.repo, item: other.item, task: LOGIN.task });
    expect((await queueOf(h)).items.map((item) => item.task)).toEqual([LOGIN.task, LOGIN.task]);
  });
});
