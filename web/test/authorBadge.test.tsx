// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RowMeta } from '../src/features/queue/list/RowBadges.tsx';
import { RunHeader } from '../src/features/runs/header/RunHeader.tsx';
import { AuthorBadge } from '../src/shared/ui/feedback/VariantBadge.tsx';
import type { AuthorView } from '../src/shared/api/types.ts';
import { cleanup, render, screen } from './render.tsx';
import { fakeApi, queueItem, runView } from './fixtures.ts';

afterEach(cleanup);

const ALICE: AuthorView = { id: 'u1', email: 'alice@corp.com', name: 'Alice', disabled: false };

describe('the author mark', () => {
  it('shows the name, with the email in the hint', () => {
    render(<AuthorBadge author={ALICE} />);
    const badge = screen.getByLabelText('Author: Alice (alice@corp.com)');
    expect(badge.textContent).toBe('Alice');
    expect(badge.getAttribute('title')).toBe('alice@corp.com');
  });

  it('keeps the author of a disabled user and says so in the hint', () => {
    render(<AuthorBadge author={{ ...ALICE, disabled: true }} />);
    expect(screen.getByLabelText('Author: Alice (alice@corp.com)').getAttribute('title')).toBe(
      'alice@corp.com (disabled)',
    );
  });

  it('says "system" for a task of the system, and shows nothing for one from before the server mode', () => {
    const { container } = render(<AuthorBadge author={null} createdBySystem={false} />);
    expect(container.textContent).toBe('');
    cleanup();
    render(<AuthorBadge author={null} createdBySystem />);
    expect(screen.getByText('system')).toBeTruthy();
    cleanup();
    render(<AuthorBadge author={ALICE} createdBySystem />);
    expect(screen.queryByText('system')).toBeNull();
    expect(screen.getByText('Alice')).toBeTruthy();
  });

  it('shows "system" in the card of a queued task by the system', () => {
    render(
      <RowMeta
        item={{ ...queueItem('q1', 'A', 1), createdBySystem: true }}
        pipelines={null}
        now={0}
      />,
    );
    expect(screen.getByText('system')).toBeTruthy();
  });

  it('is in the card of a queued task and in the header of a run, and absent without an author', () => {
    render(
      <RowMeta item={{ ...queueItem('q1', 'A', 1), author: ALICE }} pipelines={null} now={0} />,
    );
    expect(screen.getByText('Alice')).toBeTruthy();
    cleanup();
    render(<RowMeta item={queueItem('q1', 'A', 1)} pipelines={null} now={0} />);
    expect(screen.queryByLabelText(/^Author:/)).toBeNull();
    cleanup();
    render(
      <RunHeader run={runView({ author: ALICE })} api={fakeApi()} now={0} onError={vi.fn()} />,
    );
    expect(screen.getByLabelText('Author: Alice (alice@corp.com)')).toBeTruthy();
  });
});
