// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountMenu } from '../src/features/account/index.ts';
import { handleUnauthorized, markServerMode } from '../src/shared/api/http.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function open(): void {
  fireEvent.keyDown(screen.getByRole('button', { name: /Account/ }), { key: 'Enter' });
}

describe('account menu', () => {
  it('offers tokens and sign out to a developer, and no users', () => {
    render(<AccountMenu initial={{ email: 'bob@example.com', name: 'bob', admin: false }} />);
    open();
    expect(screen.getByText('bob@example.com')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Access tokens' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Users' })).toBeNull();
  });

  it('adds users for an administrator', () => {
    render(<AccountMenu initial={{ email: 'a@example.com', name: 'admin', admin: true }} />);
    open();
    expect(screen.getByRole('menuitem', { name: 'Users' })).toBeTruthy();
  });

  it('shows nothing in the local mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ mode: 'local', me: null }))),
    );
    const view = render(<AccountMenu />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(view.container.textContent).toBe('');
  });

  it('shows the value of a new token once', async () => {
    const value = `aip_pat_${'a'.repeat(43)}`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: RequestInit) => {
        const method = JSON.parse(String(init?.body ?? '{}')).method as string;
        const body =
          method === 'tokens_create'
            ? {
                value,
                token: {
                  id: '1',
                  name: 'laptop',
                  start: value.slice(0, 12),
                  createdAt: 1,
                  lastUsedAt: null,
                  expiresAt: 2,
                },
              }
            : { tokens: [] };
        return new Response(JSON.stringify(body));
      }),
    );
    render(<AccountMenu initial={{ email: 'bob@example.com', name: 'bob', admin: false }} />);
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Access tokens' }));
    fireEvent.change(await screen.findByLabelText('Token name'), { target: { value: 'laptop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(value)).toBeTruthy();
  });
});

describe('401 in the server mode', () => {
  it('sends the browser to the login page only after the mode is known', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    handleUnauthorized(401);
    expect(assign).not.toHaveBeenCalled();
    markServerMode();
    handleUnauthorized(200);
    expect(assign).not.toHaveBeenCalled();
    handleUnauthorized(401);
    expect(assign).toHaveBeenCalledWith('/auth/login');
  });
});
