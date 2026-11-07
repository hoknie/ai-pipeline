// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunHeader } from '../src/features/runs/header/RunHeader.tsx';

import { fakeApi, runView } from './fixtures.ts';
import { cleanup, fireEvent, render, screen, waitFor } from './render.tsx';

afterEach(cleanup);

function setup(setRunTitle = vi.fn(async () => runView())) {
  const api = { ...fakeApi(), setRunTitle };
  render(
    <RunHeader run={runView({ title: 'Старое' })} api={api} now={0} onError={() => undefined} />,
  );
  return setRunTitle;
}

const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit title' }));
const field = () => screen.getByRole('textbox', { name: 'Task title' }) as HTMLInputElement;

describe('run title edit in place', () => {
  it('hides the pencil until hover or focus and names it', () => {
    setup();
    const button = screen.getByRole('button', { name: 'Edit title' });
    expect(button.className).toContain('opacity-0');
    expect(button.className).toContain('group-hover:opacity-100');
    expect(button.className).toContain('focus-visible:opacity-100');
    expect(button.closest('h1')?.className).toContain('group');
  });

  it('saves on Enter and sends the trimmed title once, even when blur follows', async () => {
    const set = setup();
    edit();
    expect(field().maxLength).toBe(60);
    fireEvent.change(field(), { target: { value: '  Новое  ' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    fireEvent.blur(field());
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(expect.any(String), 'Новое');
  });

  it('saves on blur', async () => {
    const set = setup();
    edit();
    fireEvent.change(field(), { target: { value: 'Другое' } });
    fireEvent.blur(field());
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
  });

  it('cancels on Escape without a request', () => {
    const set = setup();
    edit();
    fireEvent.change(field(), { target: { value: 'Другое' } });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Старое')).toBeTruthy();
    expect(set).not.toHaveBeenCalled();
  });

  it('sends nothing for an empty or unchanged title', () => {
    const set = setup();
    edit();
    fireEvent.change(field(), { target: { value: '   ' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(screen.queryByRole('textbox')).toBeNull();
    edit();
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(set).not.toHaveBeenCalled();
  });

  it('keeps the field open and shows the error when saving fails', async () => {
    const set = setup(
      vi.fn(async () => {
        throw new Error('daemon refused');
      }),
    );
    edit();
    fireEvent.change(field(), { target: { value: 'Другое' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(await screen.findByText('daemon refused')).toBeTruthy();
    expect(field().value).toBe('Другое');
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('does not save a stale draft when blur follows Escape', () => {
    const set = setup();
    edit();
    const input = field();
    fireEvent.change(input, { target: { value: 'Другое' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(set).not.toHaveBeenCalled();
  });

  it('sends exactly one request when blur follows a completed Enter save', async () => {
    const set = setup();
    edit();
    const input = field();
    fireEvent.change(input, { target: { value: 'Новое' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    fireEvent.blur(input);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the pencil after Escape', () => {
    setup();
    edit();
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit title' }));
  });

  it('does not resend the rejected title on blur', async () => {
    const set = setup(
      vi.fn(async () => {
        throw new Error('daemon refused');
      }),
    );
    edit();
    fireEvent.change(field(), { target: { value: 'Другое' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await screen.findByText('daemon refused');
    fireEvent.blur(field());
    expect(set).toHaveBeenCalledTimes(1);
  });
});
