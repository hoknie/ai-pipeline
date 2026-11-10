// @vitest-environment jsdom
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoryFilterFields } from '../src/features/settings/observers/history/HistoryFilterFields.tsx';
import {
  HistoryCard,
  HistoryItem,
} from '../src/features/settings/observers/history/HistoryItem.tsx';
import { HistoryPagination } from '../src/features/settings/observers/history/HistoryPagination.tsx';
import { HistoryTab } from '../src/features/settings/observers/history/HistoryTab.tsx';
import type { ObserverHistoryItem } from '../src/shared/api/observerHistoryApi.ts';
import { fakeApi } from './fixtures.ts';
import { act, cleanup, fireEvent, render, screen, within } from './render.tsx';

describe('observer history UI components', () => {
  beforeEach(async () => {
    await act(() => i18next.changeLanguage('en'));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const item: ObserverHistoryItem = {
    id: 'r1:_repair:2',
    runId: 'r1',
    runNumber: 42,
    runTitle: 'Fix Task',
    repository: '/work/app',
    attemptSeq: 2,
    runtime: 'claude',
    model: 'claude-3-7-sonnet',
    startedAt: 1000,
    finishedAt: 5000,
    status: 'failed',
    verdict: null,
    result: 'failed',
    failureKind: 'process_aborted',
    usage: { inputTokens: 12500, outputTokens: 800, costUsd: 0.045 },
  };

  it('renders run number, attempt seq, failureKind, badges, finished time and exact tokens in tooltip', () => {
    render(
      <table>
        <tbody>
          <HistoryItem item={item} asOf={6000} />
        </tbody>
      </table>,
    );

    expect(screen.getByText('#42')).toBeTruthy();
    expect(screen.getByText('attempt #2')).toBeTruthy();
    expect(screen.getByText('Fix Task')).toBeTruthy();
    expect(screen.getByText('(process_aborted)')).toBeTruthy();
    // Short clock time in the row, the full date with the year in the tooltip of start and end.
    const times = Array.from(document.querySelectorAll('time'));
    expect(times).toHaveLength(2);
    for (const time of times) expect(time.getAttribute('title')).toMatch(/1970/);
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText(/12.5k \/ 800/)).toBeTruthy();
    const span = screen.getByTitle(/800/);
    expect(span).toBeTruthy();
    expect(span.getAttribute('title')).toMatch(/12.*500 \/ 800/);
  });

  it('renders card view with all fields', () => {
    render(<HistoryCard item={item} asOf={6000} />);
    expect(screen.getByText('#42')).toBeTruthy();
    expect(screen.getByText('attempt #2')).toBeTruthy();
    expect(screen.getByText('(process_aborted)')).toBeTruthy();
  });

  it('renders pagination with page number and triggers back and next', () => {
    const next = vi.fn();
    const back = vi.fn();
    const history = {
      page: { nextCursor: 'next-123' },
      busy: false,
      canBack: true,
      pageNumber: 3,
      back,
      next,
    };
    render(<HistoryPagination history={history} />);
    expect(screen.getByText(/Page 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(next).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(back).toHaveBeenCalled();
  });

  it('renders controlled from and to inputs in HistoryFilterFields', () => {
    const history = {
      filters: {
        from: new Date('2026-05-10T10:00:00').getTime(),
        to: new Date('2026-05-10T12:00:00').getTime(),
      },
      update: vi.fn(),
      reset: vi.fn(),
    };
    render(<HistoryFilterFields history={history} projects={['/work/app']} />);
    const fromInput = screen.getByLabelText<HTMLInputElement>('From (local time)');
    const toInput = screen.getByLabelText<HTMLInputElement>('To (local time)');
    expect(fromInput.value).toContain('2026-05-10');
    expect(toInput.value).toContain('2026-05-10');
  });

  it('shows empty message when no items', async () => {
    const api = fakeApi({
      observerHistory: vi.fn(async () => ({
        items: [],
        nextCursor: null,
        limit: 20 as const,
        projects: ['/work/app'],
        asOf: 100,
      })),
    });
    render(<HistoryTab api={api} />);
    expect(await screen.findByText(i18next.t('observers.history.empty'))).toBeTruthy();
  });

  it('switches between table and cards by the width of the history area, not of the window', async () => {
    const api = fakeApi({
      observerHistory: vi.fn(async () => ({
        items: [item],
        nextCursor: null,
        limit: 20 as const,
        projects: ['/work/app'],
        asOf: 6000,
      })),
    });
    const { container } = render(<HistoryTab api={api} />);
    await screen.findAllByText('Fix Task');
    // A wide window with a narrow settings column must still get the cards: jsdom does not lay
    // out, so check that both views answer to the container of the history, not to the viewport.
    const area = container.querySelector('section');
    expect(area?.className.split(' ')).toContain('@container');
    const table = container.querySelector('table')?.parentElement;
    expect(table?.className).toContain('@min-[64rem]:block');
    expect(table?.className).not.toMatch(/(^| )min-\[64rem\]/);
    const cards = table?.nextElementSibling;
    expect(cards?.className).toContain('@min-[64rem]:hidden');
    expect(cards?.className).not.toMatch(/(^| )min-\[64rem\]/);
    expect(container.innerHTML).not.toMatch(/ (sm|lg):grid-cols/);
    // The project goes by its name with the full path in the tooltip; long names and models wrap
    // instead of widening the page.
    for (const view of [table!, cards!]) {
      const project = within(view as HTMLElement).getByText('app');
      expect(project.className).toContain('break-all');
      expect(project.parentElement?.getAttribute('title')).toBe('/work/app');
      expect(within(view as HTMLElement).getByText('claude-3-7-sonnet').className).toContain(
        'break-all',
      );
    }
    expect(container.querySelector('table')?.className).toContain('table-fixed');
  });

  it('updates live timer for running attempt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(6000));
    const runningItem: ObserverHistoryItem = {
      ...item,
      result: 'running',
      status: 'running',
      finishedAt: null,
    };
    const api = fakeApi({
      observerHistory: vi.fn(async () => ({
        items: [runningItem],
        nextCursor: null,
        limit: 20 as const,
        projects: ['/work/app'],
        asOf: 1000,
      })),
    });
    const view = render(<HistoryTab api={api} />);
    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getAllByText('Fix Task')).toHaveLength(2);
      const initialDuration = screen.getAllByText(/5s/)[0]?.textContent;
      const requestCount = vi.mocked(api.observerHistory).mock.calls.length;
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getAllByText(/7s/)).toHaveLength(2);
      expect(screen.queryAllByText(/5s/)).toHaveLength(0);
      expect(vi.mocked(api.observerHistory).mock.calls).toHaveLength(requestCount);
      expect(initialDuration).toContain('5s');
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });
});
