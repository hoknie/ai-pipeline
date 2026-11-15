// @vitest-environment jsdom
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinksEditTab } from '../src/features/runs/links/LinksEditTab.tsx';
import { RunHeader } from '../src/features/runs/header/RunHeader.tsx';
import { fakeApi, runView } from './fixtures.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { chooseKind, kindOptions } from './linkKind.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const parent = {
  kind: 'parent' as const,
  id: 'p',
  ref: 'run' as const,
  number: 3,
  title: 'Parent',
  repository: '/repo',
};
const child = {
  kind: 'parent' as const,
  id: 'c',
  ref: 'item' as const,
  number: 4,
  title: 'Child',
  repository: '/repo',
};
const related = {
  kind: 'related' as const,
  id: 'r',
  ref: 'run' as const,
  number: 7,
  title: 'Related',
  repository: '/repo',
};
const choices = () => [
  { section: 'finished' as const, options: [{ id: 'r', number: 7, title: 'Related' }] },
];

async function openMenu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'More' }), {
    button: 0,
    ctrlKey: false,
  });
  return screen.findByRole('menuitem', { name: 'Add link…' });
}

describe('run links', () => {
  it('shows direct and inverse links even without queue choices, and disables adding', async () => {
    render(
      <RunHeader
        run={runView({ links: [parent], linkedBy: [child] })}
        api={fakeApi()}
        now={0}
        onError={() => {}}
      />,
    );
    const section = screen.getByRole('region', { name: 'Links' });
    expect(within(section).getByRole('link', { name: '#3 Parent' }).getAttribute('href')).toBe(
      '#runs/p',
    );
    expect(within(section).getByRole('link', { name: '#4 Child' }).getAttribute('href')).toBe(
      '#queue',
    );
    expect((await openMenu()).getAttribute('data-disabled')).not.toBeNull();
  });

  it('adds a non-blocking link and displays run-event changes', async () => {
    const api = fakeApi();
    const run = runView({ links: [parent] });
    const view = render(
      <RunHeader run={run} api={api} now={0} onError={() => {}} linkChoices={choices} />,
    );
    fireEvent.click(await openMenu());
    const dialog = await screen.findByRole('dialog', { name: 'Add link' });
    const kind = within(dialog).getByRole('combobox', { name: 'Link kind' });
    const names = (await kindOptions(kind)).map((option) => option.textContent);
    expect(names).toEqual(['Related', 'Duplicates']);
    fireEvent.click(screen.getByRole('option', { name: 'Duplicates' }));
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Linked task' }));
    fireEvent.click(await screen.findByRole('option', { name: '#7 Related' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' }));
    await waitFor(() => expect(api.taskLink).toHaveBeenCalledWith(run.id, 'duplicates', 'r'));
    expect(screen.queryByText('Duplicates:')).toBeNull();
    view.rerender(
      <RunHeader
        run={{ ...run, links: [parent, { ...related, kind: 'duplicates' }] }}
        api={api}
        now={0}
        onError={() => {}}
        linkChoices={choices}
      />,
    );
    expect(screen.getByText('Duplicates:')).toBeTruthy();
  });

  it('keeps an add error in the dialog and notifies unlink errors', async () => {
    const notify = vi.spyOn(toast, 'error');
    const api = fakeApi({
      taskLink: vi.fn(async () => {
        throw new Error('add failed');
      }),
      taskUnlink: vi.fn(async () => {
        throw new Error('remove failed');
      }),
    });
    render(
      <RunHeader
        run={runView({ links: [related] })}
        api={api}
        now={0}
        onError={() => {}}
        linkChoices={choices}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove link: Related' }));
    await waitFor(() => expect(api.taskUnlink).toHaveBeenCalledWith('run1', 'related', 'r'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('remove failed', expect.anything()));
    fireEvent.click(await openMenu());
    const dialog = await screen.findByRole('dialog', { name: 'Add link' });
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Linked task' }));
    fireEvent.click(await screen.findByRole('option', { name: '#7 Related' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add link' }));
    expect(await within(dialog).findByText('add failed')).toBeTruthy();
    expect(within(dialog).getByRole('combobox', { name: 'Linked task' }).textContent).toContain(
      'Related',
    );
  });

  it('draws the links as two blocks under a rule and collapses the section', () => {
    render(
      <RunHeader
        run={runView({ links: [parent], linkedBy: [child] })}
        api={fakeApi()}
        now={0}
        onError={() => {}}
      />,
    );
    const section = screen.getByRole('region', { name: 'Links' });
    expect(section.className).toContain('border-t');
    const outgoing = within(section).getByRole('heading', { name: 'Outgoing' }).parentElement!;
    const incoming = within(section).getByRole('heading', { name: 'Incoming' }).parentElement!;
    expect(within(outgoing).getByRole('link', { name: '#3 Parent' })).toBeTruthy();
    expect(within(outgoing).queryByRole('link', { name: '#4 Child' })).toBeNull();
    expect(within(incoming).getByRole('link', { name: '#4 Child' })).toBeTruthy();
    const toggle = within(section).getByRole('button', { name: /Links/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(section).queryByRole('heading', { name: 'Outgoing' })).toBeNull();
    fireEvent.click(toggle);
    expect(within(section).getByRole('heading', { name: 'Incoming' })).toBeTruthy();
  });

  it('saves the edited links: unlinks removed rows first, then links added ones', async () => {
    const api = fakeApi();
    const run = runView({ links: [related] });
    render(<LinksEditTab run={run} api={api} choices={choices} />);
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(save.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    await chooseKind(screen.getByRole('combobox', { name: 'Link kind' }), 'Duplicates');
    fireEvent.click(screen.getByRole('combobox', { name: 'Linked task' }));
    fireEvent.click(await screen.findByRole('option', { name: '#7 Related' }));
    fireEvent.click(save);
    await waitFor(() => expect(api.taskLink).toHaveBeenCalledWith(run.id, 'duplicates', 'r'));
    expect(api.taskUnlink).toHaveBeenCalledWith(run.id, 'related', 'r');
    expect(vi.mocked(api.taskUnlink).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(api.taskLink).mock.invocationCallOrder[0]!,
    );
  });

  it('keeps the draft and shows the error when a save fails', async () => {
    const api = fakeApi({
      taskUnlink: vi.fn(async () => {
        throw new Error('remove failed');
      }),
    });
    render(<LinksEditTab run={runView({ links: [related] })} api={api} choices={choices} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('remove failed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove link' })).toBeNull();
  });
});
