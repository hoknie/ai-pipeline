// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';

import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { fakeApi, openFake, queueItem, queueOf } from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '#runs';
});

afterEach(() => {
  cleanup();
});

function strip() {
  return within(screen.getByRole('banner'));
}

describe('new task from the top strip', () => {
  it('opens the dialog over the section and announces the created task', async () => {
    const api = fakeApi({
      queue: vi.fn(async () => queueOf()),
      queueAdd: vi.fn(async () => ({
        ...queueOf({ items: [queueItem('q12', 'Сделать вход', 12)] }),
        item: 'q12',
      })),
    });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    const hash = window.location.hash;
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await waitFor(() => expect(document.activeElement?.id).toBe('new-task'));
    expect(window.location.hash).toBe(hash);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Pipeline' }).textContent).toBe('feature'),
    );
    fireEvent.change(within(dialog).getByLabelText('Task text'), {
      target: { value: 'Сделать вход' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getAllByText('Task #12 created').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    expect(window.location.hash).toBe(hash);
  });

  it('keeps the button disabled until the queue is loaded', async () => {
    let answer: (() => void) | undefined;
    const api = fakeApi({
      queue: vi.fn(
        () =>
          new Promise<ReturnType<typeof queueOf>>((resolve) => {
            answer = () => resolve(queueOf());
          }),
      ),
    });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    expect(button.disabled).toBe(true);
    await waitFor(() => expect(answer).toBeDefined());
    answer?.();
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it('shares the draft with the queue page', async () => {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()) });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    fireEvent.change(within(dialog).getByLabelText('Task text'), { target: { value: 'черновик' } });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull());
    window.location.hash = '#queue';
    const controls = await screen.findByRole('region', { name: 'queue controls' });
    fireEvent.click(within(controls).getByRole('button', { name: 'New task' }));
    const again = await screen.findByRole('dialog', { name: 'New task' });
    expect((within(again).getByLabelText('Task text') as HTMLTextAreaElement).value).toBe(
      'черновик',
    );
  });
  it('gives every field of the new task dialog the same height', async () => {
    const api = fakeApi({ queue: vi.fn(async () => queueOf()) });
    render(<App api={api} openStream={openFake} />);
    const button = strip().getByRole<HTMLButtonElement>('button', { name: 'New task' });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    const field = within(dialog);
    expect(field.getByPlaceholderText('Name (optional)').className).toContain('h-9.5');
    expect(field.getByRole('combobox', { name: 'Pipeline' }).className).toContain('h-9.5');
    expect(field.getByRole('combobox', { name: 'Delivery mode' }).className).toContain('h-9.5');
    expect(field.getByRole('combobox', { name: 'Waits for' }).parentElement?.className).toContain(
      'min-h-9.5',
    );
    expect(field.getByRole('combobox', { name: 'Tags' }).parentElement?.className).toContain(
      'min-h-9.5',
    );
  });
});
