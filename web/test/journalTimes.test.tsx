// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GroupScreen } from '../src/features/runs/group/GroupScreen.tsx';
import { MessageDialog } from '../src/features/runs/group/MessageDialog.tsx';
import { Transcript } from '../src/features/runs/transcript/Transcript.tsx';
import { clockSeconds, dateTime } from '../src/shared/lib/format.ts';
import { useElementHeight } from '../src/shared/lib/browser/useElementHeight.ts';
import type { TranscriptEntry } from '../src/shared/api/types.ts';

import { fakeApi, groupRow, groupView } from './fixtures.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const AT = new Date(2026, 0, 10, 14, 32, 5).getTime();

describe('format of the time of a log line', () => {
  it('writes the clock with seconds and the full date for a hint', () => {
    expect(clockSeconds(AT)).toBe('14:32:05');
    expect(clockSeconds(new Date(2026, 0, 10, 3, 4, 9).getTime())).toBe('03:04:09');
    expect(dateTime(AT, 'en')).toContain('2026');
    expect(dateTime(AT, 'en')).toContain('2:32:05');
  });
});

describe('time in the transcript', () => {
  const entries: TranscriptEntry[] = [
    { kind: 'text', text: 'Читаю файл', at: AT },
    { kind: 'tool_call', id: 't1', name: 'Bash', summary: 'npm test', input: '{}', at: AT + 1000 },
    { kind: 'tool_result', id: 't1', text: 'ok', error: false, at: AT + 2000 },
    {
      kind: 'result',
      text: null,
      error: false,
      verdict: 'done',
      inputTokens: 1,
      outputTokens: 2,
      costUsd: null,
      at: AT + 3000,
    },
  ];

  it('shows the time of the text, the call, the result and the total, with the date in a hint', () => {
    const { container } = render(<Transcript entries={entries} />);
    const shown = [...container.querySelectorAll('time')];
    expect(shown.map((time) => time.textContent)).toEqual([
      '14:32:05',
      '14:32:06',
      '14:32:07',
      '14:32:08',
    ]);
    expect(shown[0]?.getAttribute('title')).toContain('2026');
    expect(shown[0]?.getAttribute('datetime')).toBe(new Date(AT).toISOString());
    const call = screen.getByRole('button', { name: /Bash/ });
    expect(within(call).getByText('14:32:06')).toBeTruthy();
  });

  it('shows no time for entries without it', () => {
    const { container } = render(
      <Transcript
        entries={[
          { kind: 'text', text: 'a' },
          { kind: 'text', text: 'b', at: null },
          { kind: 'tool_call', id: null, name: 'Bash', summary: 'ls', input: '{}' },
        ]}
      />,
    );
    expect(container.querySelector('time')).toBeNull();
  });

  it('keeps the time of the texts when only the replies are shown', () => {
    const { container } = render(<Transcript entries={entries} onlyText />);
    expect([...container.querySelectorAll('time')].map((time) => time.textContent)).toEqual([
      '14:32:05',
    ]);
  });
});

function screenOf(attempts: Parameters<typeof groupView>[0]) {
  const view = groupView(attempts);
  const with_ = fakeApi({ group: vi.fn(async () => view) });
  render(
    <GroupScreen
      api={with_}
      runId="run1"
      row={groupRow({ status: 'running' })}
      draftKey="run1/login"
      drafts={{}}
      onDraft={() => undefined}
      onClearDrafts={() => undefined}
      onError={() => undefined}
    />,
  );
  return with_;
}

const running = groupView().attempts[0]!;

describe('attempt header and message', () => {
  it('shows when the attempt started and the message the person sent', async () => {
    screenOf({
      attempts: [
        { ...running, startedAt: AT, message: { text: 'Смотри в **src/auth**', at: AT + 5000 } },
      ],
    });
    expect(await screen.findByText(`Attempt started · 14:32:05`)).toBeTruthy();
    const block = await screen.findByRole('region', { name: 'Message from the person' });
    expect(within(block).getByText('14:32:10')).toBeTruthy();
    expect(within(block).getByText('src/auth').tagName).toBe('STRONG');
  });

  it('shows no message block for an attempt without a message', async () => {
    screenOf({ attempts: [running] });
    await screen.findByText(/^Attempt started/);
    expect(screen.queryByRole('region', { name: 'Message from the person' })).toBeNull();
  });

  it('sticks the header of the attempt under the header of the group', async () => {
    screenOf({ attempts: [running] });
    const trigger = await screen.findByRole('button', { name: /^attempt 1/ });
    const header = trigger.parentElement!;
    expect(header.className).toContain('sticky');
    expect(header.className).toContain('top-[var(--group-header-height,0px)]');
    expect(header.className).toContain('bg-card');
    const section = screen.getByRole('region', { name: /Вход/ });
    expect(section.style.getPropertyValue('--group-header-height')).toBe('0px');
  });

  it('offers the message button in the header of the running last attempt only', async () => {
    const finished = { ...running, seq: 1, status: 'finished', verdict: 'done' };
    const current = { ...running, seq: 2, status: 'running', verdict: null };
    screenOf({ attempts: [finished, current] });
    await screen.findByRole('button', { name: /^attempt 2/ });
    const buttons = screen.getAllByRole('button', { name: 'Message to the specialist' });
    expect(buttons).toHaveLength(1);
    const expanded = screen.getByRole('button', { name: /^attempt 2/ });
    expect(expanded.parentElement?.contains(buttons[0]!)).toBe(true);
    fireEvent.click(buttons[0]!);
    // the click opens the dialog and does not fold the attempt
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(expanded.getAttribute('aria-expanded')).toBe('true');
  });

  it('hides the button of a finished, a reporting or an interrupted attempt', async () => {
    screenOf({
      attempts: [{ ...running, status: 'running', verdict: 'done', summary: 'готово' }],
    });
    await screen.findByRole('button', { name: /^attempt 1/ });
    expect(screen.queryByRole('button', { name: 'Message to the specialist' })).toBeNull();
    cleanup();
    screenOf({ attempts: [{ ...running, status: 'running', interrupting: true }] });
    await screen.findByText('interrupting…');
    expect(screen.queryByRole('button', { name: 'Message to the specialist' })).toBeNull();
    cleanup();
    screenOf({ attempts: [{ ...running, status: 'failed' }] });
    await screen.findByRole('button', { name: /^attempt 1/ });
    expect(screen.queryByRole('button', { name: 'Message to the specialist' })).toBeNull();
  });

  it('sends the text with the number of the attempt and says so', async () => {
    const api = screenOf({ attempts: [running] });
    fireEvent.click(await screen.findByRole('button', { name: 'Message to the specialist' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Message'), {
      target: { value: '  используй OAuth  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(api.message).toHaveBeenCalledWith('run1', 'login', 1, '  используй OAuth  '),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await screen.findAllByText('Message sent')).length).toBeGreaterThan(0);
  });

  it('keeps the dialog and the text open when the daemon refuses', async () => {
    const onError = vi.fn();
    const message = vi.fn(async () => {
      throw new Error('attempt 1 is not running');
    });
    const api = fakeApi({ message });
    render(
      <GroupScreen
        api={api}
        runId="run1"
        row={groupRow({ status: 'running' })}
        draftKey="run1/login"
        drafts={{}}
        onDraft={() => undefined}
        onClearDrafts={() => undefined}
        onError={onError}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Message to the specialist' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Message'), { target: { value: 'текст' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('attempt 1 is not running'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(
      (within(screen.getByRole('dialog')).getByLabelText('Message') as HTMLTextAreaElement).value,
    ).toBe('текст');
  });
});

describe('message dialog', () => {
  it('does not send an empty text and sends with Ctrl+Enter', async () => {
    const onSend = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<MessageDialog onSend={onSend} onClose={onClose} />);
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const field = screen.getByLabelText('Message');
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: 'привет' } });
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('привет'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('warns that the specialist is interrupted and closes with Cancel', () => {
    const onClose = vi.fn();
    render(<MessageDialog onSend={async () => undefined} onClose={onClose} />);
    expect(screen.getByText(/interrupted/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('useElementHeight', () => {
  function Probe({ element }: { element: Element | null }) {
    return <span>{`h=${useElementHeight(element)}`}</span>;
  }

  it('is 0 without ResizeObserver or without an element', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const element = document.createElement('div');
    render(<Probe element={element} />);
    expect(screen.getByText('h=0')).toBeTruthy();
    cleanup();
    vi.stubGlobal('ResizeObserver', class {});
    render(<Probe element={null} />);
    expect(screen.getByText('h=0')).toBeTruthy();
  });

  it('follows the height of the element and disconnects on unmount', () => {
    let notify: () => void = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {}
        disconnect() {
          disconnect();
        }
      },
    );
    const element = document.createElement('div');
    let height = 48;
    element.getBoundingClientRect = () => ({ height }) as DOMRect;
    const { unmount } = render(<Probe element={element} />);
    expect(screen.getByText('h=48')).toBeTruthy();
    height = 71.2;
    act(() => notify());
    expect(screen.getByText('h=72')).toBeTruthy();
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
