// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountMenu } from '../src/features/account/index.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const EVENTS = [
  {
    id: 2,
    at: 2000,
    subject: 'u2',
    user: { id: 'u2', email: 'bob@corp.com', name: 'Bob' },
    action: 'run.cancel',
    repository: '/app',
    resourceKind: 'run',
    resourceId: 'r1',
    outcome: 'ok',
    details: { group: 'login' },
    error: null,
  },
  {
    id: 1,
    at: 1000,
    subject: 'u3',
    user: null,
    action: 'config.global.write',
    repository: null,
    resourceKind: null,
    resourceId: null,
    outcome: 'denied',
    details: {},
    error: 'needs an administrator',
  },
];

function stubAudit() {
  const fetchMock = vi.fn(
    async (_path: string) => new Response(JSON.stringify({ events: EVENTS })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const admin = { email: 'a@corp.com', name: 'admin', admin: true };

async function openJournal() {
  fireEvent.keyDown(screen.getByRole('button', { name: /Account/ }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Journal' }));
}

describe('the journal page', () => {
  it('is offered to an administrator only', () => {
    render(<AccountMenu initial={{ ...admin, admin: false }} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Account/ }), { key: 'Enter' });
    expect(screen.queryByRole('menuitem', { name: 'Journal' })).toBeNull();
  });

  it('lists the entries, the newest first, with the outcome and the details', async () => {
    const fetchMock = stubAudit();
    render(<AccountMenu initial={admin} />);
    await openJournal();
    expect(await screen.findByText('run.cancel')).toBeTruthy();
    expect(screen.getByText('bob@corp.com')).toBeTruthy();
    expect(screen.getByText('denied')).toBeTruthy();
    expect(screen.getByText(/run r1 · group=login/)).toBeTruthy();
    expect(screen.getByText(/needs an administrator/)).toBeTruthy();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/audit?since=7d');
  });

  it('asks again with the filters of the user, project, action and period', async () => {
    const fetchMock = stubAudit();
    render(<AccountMenu initial={admin} />);
    await openJournal();
    await screen.findByText('run.cancel');
    fireEvent.change(screen.getByLabelText('User (email)'), { target: { value: 'bob@corp.com' } });
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'app' } });
    fireEvent.change(screen.getByLabelText('Action, e.g. run.'), { target: { value: 'run.' } });
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '1d' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const query = new URL(String(fetchMock.mock.calls[1]?.[0]), 'http://x').searchParams;
    expect(Object.fromEntries(query)).toEqual({
      user: 'bob@corp.com',
      repository: 'app',
      action: 'run.',
      since: '1d',
    });
  });

  it('shows the refusal of the daemon', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'no access' }), { status: 403 })),
    );
    render(<AccountMenu initial={admin} />);
    await openJournal();
    expect((await screen.findByRole('alert')).textContent).toBe('no access');
  });
});
