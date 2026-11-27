// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { projectsFields } from '../src/features/queue/form/sharedTag.ts';
import { ApiError } from '../src/shared/api/api.ts';
import type { QueueFields } from '../src/shared/api/types.ts';
import { en } from '../src/shared/i18n/locales/en.ts';
import { es } from '../src/shared/i18n/locales/es.ts';
import { ru } from '../src/shared/i18n/locales/ru.ts';
import { zh } from '../src/shared/i18n/locales/zh.ts';

import {
  markdownValue,
  setMarkdown,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from './render.tsx';
import { fakeApi, openFake, queueOf } from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '#runs';
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

const REFUSAL = 'task #12 (q1) with the same pipeline and task already waits in the queue';

/** A panel whose queue refuses a copy unless it is asked for, with the dialog open and filled. */
async function dialogWith(queueAdd: (fields: QueueFields) => Promise<never | unknown>) {
  const api = fakeApi({ queue: vi.fn(async () => queueOf()), queueAdd: vi.fn(queueAdd) as never });
  render(<App api={api} openStream={openFake} />);
  const strip = within(screen.getAllByRole('banner')[0]!);
  const button = strip.getByRole<HTMLButtonElement>('button', { name: 'New task' });
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: 'New task' });
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
  );
  const text = within(dialog).getByLabelText('Task text');
  setMarkdown(text, 'fix the login');
  return { api, dialog, text };
}

const refuseCopies = async (fields: QueueFields) => {
  if (fields.allowDuplicate) return { ...queueOf(), item: 'q2' };
  throw new ApiError(409, REFUSAL, 'duplicate_task');
};

describe('a copy of a waiting task in the new task form', () => {
  it('keeps the form open, names the waiting task and offers to add the copy anyway', async () => {
    const { api, dialog, text } = await dialogWith(refuseCopies);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    const notice = await within(dialog).findByText('This task already waits in the queue as #12.');
    expect(notice.getAttribute('title')).toBe(REFUSAL);
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy();
    expect(markdownValue(text)).toBe('fix the login');
    expect(api.queueAdd).toHaveBeenCalledTimes(1);
    expect(api.queueAdd).toHaveBeenLastCalledWith({
      provider: null,
      pipeline: 'feature',
      task: 'fix the login',
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add anyway' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalledTimes(2));
    expect(api.queueAdd).toHaveBeenLastCalledWith({
      provider: null,
      pipeline: 'feature',
      task: 'fix the login',
      allowDuplicate: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
  });

  it('forgets the refusal when the text changes, and sends the next task as usual', async () => {
    const { api, dialog, text } = await dialogWith(refuseCopies);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await within(dialog).findByRole('button', { name: 'Add anyway' });
    setMarkdown(text, 'fix the logout');
    await waitFor(() =>
      expect(within(dialog).queryByRole('button', { name: 'Add anyway' })).toBeNull(),
    );
    expect(within(dialog).queryByText(/already waits in the queue/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.queueAdd).toHaveBeenCalledTimes(2));
    expect(api.queueAdd).toHaveBeenLastCalledWith({
      provider: null,
      pipeline: 'feature',
      task: 'fix the logout',
    });
  });

  it('shows any other refusal as before, without the way around', async () => {
    const { dialog } = await dialogWith(async () => {
      throw new ApiError(400, 'unknown pipeline `nope`; known: feature');
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await within(dialog).findByText('unknown pipeline `nope`; known: feature');
    expect(within(dialog).queryByRole('button', { name: 'Add anyway' })).toBeNull();
  });

  it('passes the choice to a task for several projects too', () => {
    const input = { projects: ['/a', '/b'], notes: {}, tag: '', chain: false };
    const fields = { pipeline: 'feature', task: 'x' };
    expect(projectsFields(fields, input)).not.toHaveProperty('allowDuplicate');
    expect(projectsFields({ ...fields, allowDuplicate: true }, input)).toHaveProperty(
      'allowDuplicate',
      true,
    );
  });

  it('has the notice and the action in every language', () => {
    for (const locale of [en, es, ru, zh]) {
      expect(locale.queue.form.duplicate).toContain('{{number}}');
      expect(locale.queue.form.duplicateUnknown.length).toBeGreaterThan(0);
      expect(locale.queue.form.addAnyway.length).toBeGreaterThan(0);
    }
  });
});
