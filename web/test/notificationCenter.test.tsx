// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationCenter } from '../src/components/shell/NotificationCenter.tsx';
import { useNotificationCenter, type BrowserPermission } from '../src/notifications.ts';

import { groupRow, runView } from './fixtures.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const runs = [
  runView({
    id: 'r1',
    repository: '/work/app',
    groups: [
      groupRow({ slug: 'q', title: 'Вопрос', status: 'needs_human', question: 'Какой провайдер?' }),
      groupRow({ slug: 'f', title: 'Падение', status: 'failed', reason: 'boom' }),
    ],
  }),
];

function stub(permission: string, answer = permission) {
  const request = vi.fn(async () => {
    (Notification as unknown as { permission: string }).permission = answer;
    return answer;
  });
  vi.stubGlobal(
    'Notification',
    Object.assign(function () {}, { permission, requestPermission: request }),
  );
  return request;
}

function Harness({
  list = runs,
  onOpen = () => {},
  compact = true,
  many = false,
}: {
  list?: typeof runs;
  onOpen?: (slug: string) => void;
  compact?: boolean;
  many?: boolean;
}) {
  const state = useNotificationCenter(list, (item) => onOpen(item.slug));
  const [, tick] = useState(0);
  return (
    <div>
      <NotificationCenter state={state} compact={compact} showRepository={many} />
      <button onClick={() => tick((n) => n + 1)}>tick</button>
    </div>
  );
}

const bell = (name: string | RegExp = /^Notifications/) => screen.getByRole('button', { name });

describe('notification centre', () => {
  it('shows a counter before opening and clears it once the list is open', () => {
    stub('granted');
    render(<Harness />);
    expect(bell('Notifications, 2 unread')).toBeTruthy();
    fireEvent.click(bell());
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Вопрос')).toBeTruthy();
    expect(within(dialog).getByText('Какой провайдер?')).toBeTruthy();
    expect(within(dialog).getByText('Needs answer')).toBeTruthy();
    expect(within(dialog).getByText('Failed')).toBeTruthy();
  });

  it('names the repository only when there is more than one', () => {
    stub('granted');
    render(<Harness many />);
    fireEvent.click(bell());
    expect(screen.getAllByText(/добавить вход · app/)).toHaveLength(2);
  });

  it('shows an empty state', () => {
    stub('granted');
    render(<Harness list={[runView()]} />);
    fireEvent.click(bell());
    expect(screen.getByText('No notifications')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hide all' })).toBeNull();
  });

  it('closes on Escape and returns focus to the bell', async () => {
    stub('granted');
    render(<Harness />);
    fireEvent.click(bell());
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(bell('Notifications')));
  });

  it('hides one item and then all', () => {
    stub('granted');
    render(<Harness />);
    fireEvent.click(bell());
    fireEvent.click(screen.getByRole('button', { name: 'Hide: Вопрос' }));
    expect(screen.queryByText('Вопрос')).toBeNull();
    expect(screen.getByText('Падение')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide all' }));
    expect(screen.getByText('No notifications')).toBeTruthy();
  });

  it('opens the group of an item and closes the list', () => {
    stub('granted');
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    fireEvent.click(bell());
    fireEvent.click(screen.getByText('Падение'));
    expect(onOpen).toHaveBeenCalledWith('f');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('works as a row of the navigation panel too', () => {
    stub('granted');
    render(<Harness compact={false} />);
    fireEvent.click(bell());
    expect(screen.getByText('Вопрос')).toBeTruthy();
  });

  it.each([
    ['default', 'Browser notifications are off'],
    ['granted', 'Browser notifications are on'],
    ['denied', 'Browser notifications are blocked. Allow them in the site settings.'],
  ] as [BrowserPermission, string][])('says what %s means', (permission, text) => {
    stub(permission);
    render(<Harness list={[]} />);
    fireEvent.click(bell());
    expect(screen.getByRole('status').textContent).toBe(text);
    expect(!!screen.queryByRole('button', { name: 'Enable browser notifications' })).toBe(
      permission === 'default',
    );
  });

  it('says the browser does not support notifications', () => {
    vi.stubGlobal('Notification', undefined);
    render(<Harness list={[]} />);
    fireEvent.click(bell());
    expect(screen.getByRole('status').textContent).toMatch(/does not support/);
  });

  it.each([
    ['granted', 'Browser notifications are on'],
    ['denied', 'Browser notifications are blocked. Allow them in the site settings.'],
  ])('follows the answer of the browser: %s', async (answer, text) => {
    const request = stub('default', answer);
    render(<Harness list={[]} />);
    fireEvent.click(bell());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enable browser notifications' }));
    });
    expect(request).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(text);
    expect(screen.queryByRole('button', { name: 'Enable browser notifications' })).toBeNull();
  });
});
