// @vitest-environment jsdom
import i18next from 'i18next';
import { Loader2 } from 'lucide-react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { StatusBadge } from '../src/shared/ui/feedback/StatusBadge.tsx';
import {
  connectionLabel,
  queueStateLabel,
  runStatusLabel,
  STATUS,
  statusInfo,
  waitText,
} from '../src/shared/lib/status.ts';

import { cleanup, fireEvent, render, screen } from './render.tsx';

const t = i18next.t.bind(i18next);

afterEach(() => cleanup());

describe('status labels', () => {
  it('has a label in the active language and a tone for every known code', () => {
    expect(statusInfo('needs_human', t)).toMatchObject({ label: 'Needs answer', tone: 'warn' });
    expect(statusInfo('merged', t)).toMatchObject({ label: 'Merged', tone: 'ok' });
    expect(statusInfo('apply_failed', t)).toMatchObject({ label: 'Delivery failed', tone: 'warn' });
    expect(statusInfo('failed', t)).toMatchObject({ label: 'Failed', tone: 'err' });
    expect(statusInfo('warnings', t)).toMatchObject({ tone: 'warn' });
    expect(statusInfo('running', t)).toMatchObject({ label: 'Running', tone: 'run' });
    expect(statusInfo('cancelled', t)).toMatchObject({ label: 'Cancelled', tone: 'mute' });
    for (const code of Object.keys(STATUS)) expect(statusInfo(code, t).label, code).not.toBe(code);
  });

  it('shows an unknown code as it is', () => {
    expect(statusInfo('brand_new', t)).toMatchObject({ label: 'brand_new', tone: 'mute' });
  });

  it('adds the count to a run with several groups waiting for an answer', () => {
    expect(runStatusLabel({ state: 'needs_human', waiting: 3 }, t)).toBe('Needs answer ×3');
    expect(runStatusLabel({ state: 'needs_human', waiting: 1 }, t)).toBe('Needs answer');
    expect(runStatusLabel({ state: 'active', waiting: 0 }, t)).toBe('Active');
  });

  it('names the connection and the queue states', () => {
    expect(connectionLabel('live', t)).toBe('Connected');
    expect(connectionLabel('reconnecting', t)).toBe('Reconnecting');
    expect(connectionLabel('polling', t)).toBe('Polling');
    expect(queueStateLabel('running', t)).toBe('Running');
    expect(queueStateLabel('stopped', t)).toBe('Stopped');
  });
});

describe('status spin flag', () => {
  it('spins only the statuses in progress', () => {
    expect(statusInfo('running', t).spin).toBe(true);
    expect(statusInfo('active', t).spin).toBe(true);
    expect(statusInfo('merging', t).spin).toBe(false);
    expect(statusInfo('done', t).spin).toBe(false);
    expect(statusInfo('brand_new', t).spin).toBe(false);
    for (const [code, entry] of Object.entries(STATUS))
      expect(entry.spin, code).toBe(entry.icon === Loader2);
  });

  it('rotates the badge icon of active and running only', () => {
    for (const [status, spins] of [
      ['active', true],
      ['running', true],
      ['merging', false],
      ['done', false],
    ] as const) {
      const { container, unmount } = render(<StatusBadge status={status} />);
      const svg = container.querySelector('svg');
      expect(svg?.classList.contains('motion-safe:animate-spin'), status).toBe(spins);
      unmount();
    }
  });
});

describe('status badge', () => {
  it('keeps the code in the accessible name and shows it in the tooltip on focus', async () => {
    render(<StatusBadge status="apply_failed" />);
    const badge = screen.getByLabelText('Delivery failed (apply_failed)');
    expect(badge.textContent).toBe('Delivery failed');
    fireEvent.focus(badge);
    expect(await screen.findByRole('tooltip')).toBeTruthy();
    expect((await screen.findByRole('tooltip')).textContent).toContain('apply_failed');
  });

  it('shows the label in the active language and keeps the code', async () => {
    await act(() => i18next.changeLanguage('ru'));
    render(<StatusBadge status="needs_human" />);
    expect(screen.getByLabelText('Ждёт ответа (needs_human)').textContent).toBe('Ждёт ответа');
  });

  it('truncates a long label instead of widening the page', () => {
    render(<StatusBadge status="running" label={'a very long title of a group '.repeat(5)} />);
    const text = screen.getByText(/a very long/);
    expect(text.className).toContain('truncate');
    expect(text.parentElement?.className).toContain('max-w-full');
  });
});

describe('waiting', () => {
  it('has its own status and explains the reason', () => {
    expect(statusInfo('waiting', t)).toMatchObject({
      label: 'Waiting for specialist',
      tone: 'mute',
    });
    expect(waitText({ reason: 'specialist', specialist: 'coder', name: 'Coder', max: 1 }, t)).toBe(
      'Waiting for Coder: 1 of 1 busy',
    );
    expect(waitText({ reason: 'specialist', specialist: 'coder', max: 1 } as never, t)).toBe(
      'Waiting for coder: 1 of 1 busy',
    );
    expect(waitText({ reason: 'capacity', max: 3 }, t)).toBe(
      'Waiting for a free place: swarm.max is 3',
    );
    expect(waitText({ reason: 'limit', runtime: 'claude', until: 0 }, t)).toMatch(
      /^Waiting for the claude usage limit to reset, until \d\d:\d\d$/,
    );
  });
});
