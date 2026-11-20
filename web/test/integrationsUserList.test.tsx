// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ParamField, paramsChange } from '../src/features/integrations/connections/ParamField.tsx';
import type { IntegrationSenderView } from '../src/shared/api/types.ts';

import { integrationsOverview } from './fixtures.ts';
import { cleanup, fireEvent, render, screen, waitFor } from './render.tsx';

afterEach(() => cleanup());

const param = integrationsOverview().types[0]!.params.find((one) => one.name === 'allowed_users')!;

/** The field with the state of a form, so what the field reports is what it shows next. */
function Harness({
  initial = '',
  load,
  seen,
  kind = 'telegram',
}: {
  initial?: string;
  load?: () => Promise<IntegrationSenderView[]>;
  seen?: (value: string) => void;
  kind?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ParamField
      kind={kind}
      param={param}
      value={value}
      loadSenders={load}
      onChange={(next) => {
        setValue(next);
        seen?.(next);
      }}
    />
  );
}

const field = () => screen.getByLabelText(/^Who may answer/);

describe('the field of a list of users', () => {
  it('does not add an id that does not fit the pattern', () => {
    const seen = vi.fn();
    render(<Harness seen={seen} />);
    fireEvent.change(field(), { target: { value: 'abc' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(seen).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Not a valid id');
  });

  it('splits a pasted list into chips and reports a comma separated value', () => {
    const seen = vi.fn();
    render(<Harness seen={seen} />);
    fireEvent.paste(field(), { clipboardData: { getData: () => '111, 222' } });
    expect(screen.getByRole('button', { name: 'Remove 111' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove 222' })).toBeTruthy();
    expect(seen).toHaveBeenLastCalledWith('111,222');
  });

  it('adds a chip on a comma, once per id, and removes the last one to empty the value', () => {
    const seen = vi.fn();
    render(<Harness seen={seen} />);
    fireEvent.change(field(), { target: { value: '111' } });
    fireEvent.keyDown(field(), { key: ',' });
    fireEvent.change(field(), { target: { value: '111' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(seen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove 111' }));
    expect(seen).toHaveBeenLastCalledWith('');
    const params = [param];
    expect(paramsChange(params, { allowed_users: '111' }, { allowed_users: '' })).toEqual({
      set: {},
      unset: ['allowed_users'],
    });
  });

  it('offers the people who wrote lately and adds the one that is pressed', async () => {
    const seen = vi.fn();
    const load = vi.fn(async () => [
      { user: '111', label: '@alice', at: 1 },
      { user: '222', label: null, at: 0 },
    ]);
    render(<Harness load={load} seen={seen} initial="222" />);
    fireEvent.focus(field());
    const suggestion = await screen.findByRole('button', { name: '@alice · 111' });
    expect(screen.queryByRole('button', { name: '222' })).toBeNull();
    fireEvent.click(suggestion);
    expect(seen).toHaveBeenLastCalledWith('222,111');
    expect(screen.queryByRole('button', { name: '@alice · 111' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('explains how to get a hint when nobody wrote, and how it works in Slack', async () => {
    const load = vi.fn(async () => []);
    const { unmount } = render(<Harness load={load} />);
    fireEvent.focus(field());
    expect(await screen.findByText(/send the bot \/id in the chat/)).toBeTruthy();
    unmount();
    render(<Harness load={load} kind="slack" />);
    fireEvent.focus(field());
    expect(await screen.findByText(/press a button under a question/)).toBeTruthy();
  });

  it('shows no hints where the connection does not exist yet', () => {
    render(<Harness />);
    fireEvent.focus(field());
    expect(screen.queryByText('Recently wrote to the bot')).toBeNull();
  });
});
