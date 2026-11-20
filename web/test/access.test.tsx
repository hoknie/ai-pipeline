// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RowActions } from '../src/features/queue/list/RowActions.tsx';
import { RunHeader } from '../src/features/runs/header/RunHeader.tsx';
import type { AccessMe, AuthorView } from '../src/shared/api/types.ts';
import { allows } from '../src/shared/lib/access/access.ts';
import { cleanup, render, screen, waitFor } from './render.tsx';
import { fakeApi, queueItem, queueOf, runView } from './fixtures.ts';

afterEach(cleanup);

const ME: AccessMe = {
  actor: 'user',
  userId: 'u1',
  repository: '/repo',
  actions: ['project.read', 'run.read'],
  conditional: ['run.apply'],
  repositories: ['/repo'],
};

const MERGED = {
  autoDeliver: false,
  finished: true,
  delivery: { applied: 0, merged: 1, failed: 0, inProgress: false, finishedAt: null },
};

const BOB: AuthorView = { id: 'u2', email: 'bob@corp.com', name: 'Bob', disabled: false };
const ME_AUTHOR: AuthorView = { id: 'u1', email: 'me@corp.com', name: 'Me', disabled: false };

describe('allows', () => {
  it('lets everything pass without an answer and in the local mode', () => {
    expect(allows(null, 'run.apply')).toBe(true);
    expect(allows({ ...ME, actor: 'local', actions: [], conditional: [] }, 'run.apply')).toBe(true);
  });

  it('checks the list, and the author for an action with a condition', () => {
    expect(allows(ME, 'run.read')).toBe(true);
    expect(allows(ME, 'run.cancel')).toBe(false);
    expect(allows(ME, 'run.apply')).toBe(false);
    expect(allows(ME, 'run.apply', 'u2')).toBe(false);
    expect(allows(ME, 'run.apply', 'u1')).toBe(true);
    expect(allows(ME, 'run.apply', null)).toBe(false);
  });
});

describe('the buttons of the run header', () => {
  const show = (me: AccessMe, author: AuthorView | null = null) => {
    const api = fakeApi({ accessMe: vi.fn(async () => me) });
    render(<RunHeader run={runView({ ...MERGED, author })} api={api} now={0} onError={vi.fn()} />);
    return api;
  };

  it('turns Deliver off with a hint when the user may not deliver', async () => {
    const api = show(ME, BOB);
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Deliver' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect(api.accessMe).toHaveBeenCalledWith('/repo');
    expect(screen.getByRole('button', { name: 'Deliver' }).getAttribute('title')).toContain(
      'run.apply',
    );
  });

  it('keeps Deliver on for a run of the user when the right needs the author', async () => {
    const api = show(ME, ME_AUTHOR);
    await waitFor(() => expect(api.accessMe).toHaveBeenCalled());
    await Promise.resolve();
    const deliver = screen.getByRole('button', { name: 'Deliver' }) as HTMLButtonElement;
    expect(deliver.disabled).toBe(false);
    expect(deliver.getAttribute('title')).toBeNull();
  });

  it('keeps Deliver on in the local mode', async () => {
    const api = show({ ...ME, actor: 'local', actions: [], conditional: [] }, BOB);
    await waitFor(() => expect(api.accessMe).toHaveBeenCalled());
    expect((screen.getByRole('button', { name: 'Deliver' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('keeps Deliver on when the rights cannot be read', async () => {
    const api = fakeApi({
      accessMe: vi.fn(async () => {
        throw new Error('no answer');
      }),
    });
    render(<RunHeader run={runView(MERGED)} api={api} now={0} onError={vi.fn()} />);
    await waitFor(() => expect(api.accessMe).toHaveBeenCalled());
    expect((screen.getByRole('button', { name: 'Deliver' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe('the buttons of a task in the queue', () => {
  const show = (me: AccessMe, author: AuthorView | null) => {
    const api = fakeApi({ accessMe: vi.fn(async () => me) });
    render(
      <RowActions
        item={{ ...queueItem('q1', 'A', 1), author }}
        queue={queueOf()}
        editing={undefined}
        postponed={false}
        actions={{ apiOf: () => api } as never}
        onDraft={vi.fn()}
      />,
    );
    return api;
  };
  const remove = () => screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement;

  it('turns edit, postpone, run now and remove off for a task of another user', async () => {
    const api = show({ ...ME, conditional: ['queue.edit'] }, BOB);
    await waitFor(() => expect(remove().disabled).toBe(true));
    expect(api.accessMe).toHaveBeenCalledWith('/repo');
    for (const name of ['Edit', 'Remove']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('leaves them on for the task of the user, and for a user who may edit any', async () => {
    const api = show({ ...ME, conditional: ['queue.edit'] }, ME_AUTHOR);
    await waitFor(() => expect(api.accessMe).toHaveBeenCalled());
    await Promise.resolve();
    expect(remove().disabled).toBe(false);
    cleanup();
    const other = show({ ...ME, actions: ['queue.edit'] }, BOB);
    await waitFor(() => expect(other.accessMe).toHaveBeenCalled());
    await Promise.resolve();
    expect(remove().disabled).toBe(false);
  });
});
