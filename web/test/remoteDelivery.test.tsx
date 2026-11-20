// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  deliveryBadge,
  pushFailed,
  undeliveredMark,
} from '../src/features/runs/header/delivery.ts';
import { RunHeader } from '../src/features/runs/header/RunHeader.tsx';
import { RunStatuses } from '../src/features/runs/list/RunStatuses.tsx';
import { cleanup, fireEvent, render, screen, waitFor } from './render.tsx';
import { fakeApi, groupRow, runView } from './fixtures.ts';

afterEach(cleanup);

const BRANCH = {
  remote: 'origin',
  branch: 'aip/mx1',
  url: 'https://github.com/acme/app/tree/aip/mx1',
  address: 'github.com/acme/app',
};

const delivery = { applied: 0, merged: 1, failed: 0, inProgress: false, finishedAt: 5 };

const failed = runView({
  state: 'failed',
  finished: true,
  groups: [groupRow({ status: 'merged', delivery: 'push_failed' })],
  delivery,
  deliveryStage: {
    status: 'push_failed',
    reason: '[rejected] (non-fast-forward)',
    groups: ['login'],
  },
});

const sent = runView({
  state: 'finished',
  finished: true,
  groups: [groupRow({ status: 'merged', delivery: 'applied' })],
  delivery: { ...delivery, applied: 1 },
  deliveryStage: { status: 'applied', manual: false },
  remoteBranch: BRANCH,
});

describe('the delivery of a run to a remote repository', () => {
  it('shows push_failed with the reason, not a pending delivery', () => {
    expect(pushFailed(failed)).toBe(true);
    expect(deliveryBadge(failed)).toEqual({
      status: 'push_failed',
      label: null,
      reason: '[rejected] (non-fast-forward)',
    });
    expect(undeliveredMark(failed)).toMatchObject({
      status: 'push_failed',
      reason: '[rejected] (non-fast-forward)',
    });
  });

  it('links the remote branch at a known host', () => {
    render(<RunStatuses run={sent} entry={null} />);
    const link = screen.getByRole('link', { name: 'aip/mx1' });
    expect(link.getAttribute('href')).toBe(BRANCH.url);
  });

  it('names the remote branch without a link at another host', () => {
    render(<RunStatuses run={{ ...sent, remoteBranch: { ...BRANCH, url: null } }} entry={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('aip/mx1').getAttribute('title')).toBe('Branch aip/mx1 in origin');
  });

  it('shows no branch before the push', () => {
    render(<RunStatuses run={failed} entry={null} />);
    expect(screen.queryByText('aip/mx1')).toBeNull();
    expect(screen.getByLabelText('Push failed (push_failed)')).toBeTruthy();
  });

  it('offers «Retry push» instead of «Deliver», and it calls apply', async () => {
    const api = fakeApi();
    render(<RunHeader run={failed} api={api} now={0} onError={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Deliver' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry push' }));
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('run1', false));
  });
});
