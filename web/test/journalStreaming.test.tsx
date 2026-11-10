// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Transcript } from '../src/features/runs/transcript/Transcript.tsx';
import { act, cleanup, fireEvent, render, screen } from './render.tsx';
import { fakeApi, groupRow, groupView } from './fixtures.ts';
import type { TranscriptEntry } from '../src/shared/api/types.ts';
import { GroupScreen } from '../src/features/runs/group/GroupScreen.tsx';
import { agyTranscript } from '../../src/feature/agents/clients/agy/transcript.ts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const fragment = (text: string, streamId = 'same'): TranscriptEntry => ({
  kind: 'text',
  text,
  streamId,
});

describe('streamed journal rendering', () => {
  it('renders merged markdown safely and preserves boundaries before text filtering', () => {
    const entries: TranscriptEntry[] = [
      fragment('**Привет'),
      fragment(' мир**\n<script>alert('),
      fragment('1)</script>'),
      { kind: 'raw', text: '{"hidden":true}' },
      fragment('!'),
      { kind: 'text', text: 'standalone' },
      fragment('next', 'other'),
    ];
    const { container } = render(<Transcript entries={entries} onlyText showJson={false} />);
    expect(container.firstElementChild?.children).toHaveLength(4);
    expect(screen.getByText('Привет мир').tagName).toBe('STRONG');
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('hides tool calls in only-text mode and raw JSON unless JSON is enabled', () => {
    const entries: TranscriptEntry[] = [
      fragment('answer'),
      {
        kind: 'tool_call',
        id: 'call-1',
        name: 'secret-tool',
        summary: 'secret',
        input: '{"secret":true}',
      },
      fragment('after-tool'),
      { kind: 'raw', text: '{"secret":"json"}' },
    ];
    const textOnly = render(<Transcript entries={entries} onlyText showJson={false} />);
    expect(textOnly.container.textContent).toContain('answer');
    expect(textOnly.container.textContent).not.toContain('secret-tool');
    expect(textOnly.container.textContent).not.toContain('secret');
    expect(textOnly.container.textContent).toContain('answer');
    expect(textOnly.container.textContent).toContain('after-tool');
    expect(textOnly.container.querySelectorAll('section.p-3')).toHaveLength(2);
    textOnly.unmount();
    const withoutTextFilter = render(
      <Transcript entries={entries} onlyText={false} showJson={false} />,
    );
    expect(withoutTextFilter.container.textContent).not.toContain('"secret":"json"');
    expect(withoutTextFilter.container.textContent).toContain('secret-tool');
  });

  it('keeps text fragments around hidden JSON as separate cards', () => {
    const entries: TranscriptEntry[] = [
      fragment('before', 's'),
      { kind: 'raw', text: '{"hidden":true}' },
      fragment('after', 's'),
    ];
    const { container } = render(
      <Transcript entries={entries} onlyText={false} showJson={false} />,
    );
    expect(container.textContent).not.toContain('"hidden"');
    const cards = container.querySelectorAll('section.p-3');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('before');
    expect(cards[0]?.textContent).not.toContain('after');
    expect(cards[1]?.textContent).toContain('after');
  });

  it('keeps matching stream identifiers isolated between attempt transcripts', () => {
    const { container } = render(
      <>
        <Transcript entries={[fragment('first')]} />
        <Transcript entries={[fragment('second')]} />
      </>,
    );
    expect(
      [...container.querySelectorAll('section[aria-label]')].filter((section) =>
        section.classList.contains('p-3'),
      ),
    ).toHaveLength(2);
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
  });

  it('accumulates poll pages into one response, continues at the cursor and shows original raw lines', async () => {
    vi.useFakeTimers();
    const streamedEntries = agyTranscript(
      [...'Привет'].map((text_delta) =>
        JSON.stringify({
          event: 'step_update',
          step_update: { step_index: 7, state: 'ACTIVE', step_type: 'agent_response', text_delta },
        }),
      ),
    );
    const transcript = vi
      .fn()
      .mockResolvedValueOnce({
        runId: 'run1',
        group: 'login',
        seq: 1,
        cursor: 2,
        running: true,
        entries: streamedEntries.slice(0, 3),
      })
      .mockResolvedValueOnce({
        runId: 'run1',
        group: 'login',
        seq: 1,
        cursor: 3,
        running: false,
        entries: streamedEntries.slice(3),
      });
    const view = groupView({
      attempts: [{ ...groupView().attempts[0]!, seq: 1, status: 'running' }],
      log: {
        seq: 1,
        lines: [
          '{"event":"step_update","text_delta":"При"}',
          '{"event":"step_update","text_delta":"вет"}',
        ],
      },
    });
    const api = fakeApi({ group: vi.fn(async () => view), transcript });
    await act(async () => {
      render(
        <GroupScreen
          api={api}
          runId="run1"
          row={groupRow()}
          draftKey="run1/login"
          drafts={{}}
          onDraft={() => undefined}
          onClearDrafts={() => undefined}
          onError={() => undefined}
        />,
      );
      await Promise.resolve();
    });
    const textCards = () =>
      [...document.querySelectorAll('section[aria-label]')].filter(
        (section) =>
          (section.textContent?.includes('При') || section.textContent?.includes('Привет')) &&
          section.classList.contains('p-3'),
      );
    expect(textCards()).toHaveLength(1);
    expect(screen.getByText('При')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(transcript).toHaveBeenNthCalledWith(2, 'run1', 'login', 1, 2);
    expect(textCards()).toHaveLength(1);
    expect(screen.getByText('Привет')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByText(/"text_delta":"При"/)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch'));
    const liveText = screen.getByText('Привет').textContent;
    const liveCount = textCards().length;
    view.attempts[0]!.status = 'completed';
    const completedView = groupView({
      attempts: [{ ...groupView().attempts[0]!, seq: 1, status: 'completed' }],
    });
    const reread = vi.fn(async (_run: string, _group: string, _seq: number, after: number) => ({
      runId: 'run1',
      group: 'login',
      seq: 1,
      cursor: 6,
      running: false,
      entries: streamedEntries,
    }));
    const remountApi = fakeApi({ group: vi.fn(async () => completedView), transcript: reread });
    cleanup();
    await act(async () => {
      render(
        <GroupScreen
          api={remountApi}
          runId="run1"
          row={groupRow()}
          draftKey="run1/login"
          drafts={{}}
          onDraft={() => undefined}
          onClearDrafts={() => undefined}
          onError={() => undefined}
        />,
      );
      await Promise.resolve();
    });
    expect(reread).toHaveBeenCalledWith('run1', 'login', 1, 0);
    expect(screen.getByText(liveText!)).toBeTruthy();
    expect(document.querySelectorAll('section.p-3')).toHaveLength(liveCount);
  });

  it('isolates the journals of two real attempts with the same stream id', async () => {
    const view = groupView({
      attempts: [
        { ...groupView().attempts[0]!, seq: 11, status: 'completed' },
        { ...groupView().attempts[0]!, seq: 12, status: 'completed' },
      ],
    });
    const transcript = vi.fn(async (_run: string, _group: string, seq: number) => ({
      runId: 'run1',
      group: 'login',
      seq,
      cursor: 1,
      running: false,
      entries: [fragment(seq === 11 ? 'attempt-eleven' : 'attempt-twelve')],
    }));
    await act(async () => {
      render(
        <GroupScreen
          api={fakeApi({ group: vi.fn(async () => view), transcript })}
          runId="run1"
          row={groupRow()}
          draftKey="run1/login"
          drafts={{}}
          onDraft={() => undefined}
          onClearDrafts={() => undefined}
          onError={() => undefined}
        />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^attempt 11/ }));
      await Promise.resolve();
    });
    expect(transcript).toHaveBeenCalledWith('run1', 'login', 11, 0);
    expect(transcript).toHaveBeenCalledWith('run1', 'login', 12, 0);
    expect(screen.getByText('attempt-eleven')).toBeTruthy();
    expect(screen.getByText('attempt-twelve')).toBeTruthy();
  });
});
