// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NavSidebar, type NavProps } from '../src/components/shell/NavSidebar.tsx';

import { cleanup, fireEvent, render, screen } from './render.tsx';

afterEach(() => cleanup());

function mount(extra: Partial<NavProps> = {}) {
  const props: NavProps = {
    view: 'runs',
    hrefFor: (view) => `#${view}`,
    onNavigate: () => {},
    working: 0,
    waiting: 0,
    queued: 0,
    connection: 'live',
    onPalette: () => {},
    onEnableNotifications: () => {},
    onToggleCollapsed: () => {},
    repository: {
      repositories: [],
      selected: null,
      waiting: new Map(),
      home: null,
      onSelect: () => {},
      onAdd: async () => {},
      onRemove: () => {},
    },
    ...extra,
  };
  return render(<NavSidebar {...props} />);
}

const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-nav-row]')];

describe('navigation rows', () => {
  it('puts every collapsed row on the centre axis', () => {
    const { container } = mount({ collapsed: true });
    const all = rows(container);
    expect(all).toHaveLength(12);
    for (const row of all) {
      expect(row.classList.contains('justify-center')).toBe(true);
      expect(row.classList.contains('px-0')).toBe(true);
      expect(row.classList.contains('w-full')).toBe(true);
      for (const bad of ['justify-start', 'size-8', 'px-2.5', 'px-2'])
        expect(row.classList.contains(bad)).toBe(false);
    }
  });

  it('aligns the expanded rows to the start', () => {
    const { container } = mount({ collapsed: false });
    const all = rows(container);
    expect(all).toHaveLength(12);
    for (const row of all) {
      expect(row.classList.contains('justify-start')).toBe(true);
      expect(row.classList.contains('px-2')).toBe(true);
      expect(row.classList.contains('px-2.5')).toBe(false);
    }
  });

  it('shows the counter on the icon of a collapsed section', () => {
    const { container } = mount({ collapsed: true, queued: 3 });
    const badge = screen.getByLabelText('in the queue: 3');
    expect(badge.closest('[data-nav-icon]')).not.toBeNull();
    expect(badge.classList.contains('absolute')).toBe(true);
    expect(container.querySelectorAll('[data-nav-icon] [aria-label]')).toHaveLength(1);
  });

  it('shortens a large counter in the collapsed column', () => {
    mount({ collapsed: true, queued: 150 });
    expect(screen.getByLabelText('in the queue: 150').textContent).toBe('99+');
  });

  it('keeps the full counter in an expanded row', () => {
    mount({ collapsed: false, queued: 150 });
    const badge = screen.getByLabelText('in the queue: 150');
    expect(badge.textContent).toBe('150');
    expect(badge.closest('[data-nav-icon]')).toBeNull();
  });

  it('shows the runs in progress in the run tone', () => {
    mount({ working: 3 });
    const badge = screen.getByLabelText('running: 3');
    expect(badge.textContent).toBe('3');
    expect(badge.className).toContain('status-run');
    expect(screen.queryByLabelText(/waiting for an answer/)).toBeNull();
  });

  it('adds a second badge for the runs waiting for an answer', () => {
    mount({ working: 3, waiting: 2 });
    const main = screen.getByLabelText('running: 3, waiting for an answer: 2');
    expect(main.className).toContain('status-warn');
    expect(screen.getByLabelText('waiting for an answer: 2').textContent).toBe('2');
  });

  it('keeps one corner badge on the collapsed runs icon', () => {
    const { container } = mount({ collapsed: true, working: 4, waiting: 1 });
    const badge = screen.getByLabelText('running: 4, waiting for an answer: 1');
    expect(badge.classList.contains('absolute')).toBe(true);
    expect(container.querySelectorAll('[data-nav-icon] [aria-label]')).toHaveLength(1);
    expect(screen.queryByLabelText('waiting for an answer: 1')).toBeNull();
  });

  it('shows no runs badge without runs in progress', () => {
    mount({ working: 0 });
    expect(screen.queryByLabelText(/^running: /)).toBeNull();
  });

  it('shortens a large runs counter in the collapsed column', () => {
    mount({ collapsed: true, working: 150 });
    expect(screen.getByLabelText('running: 150').textContent).toBe('99+');
  });

  it('names the collapsed buttons in tooltips', async () => {
    mount({ collapsed: true });
    for (const [name, text] of [
      [/Command palette/, 'Search and commands'],
      [/^Notifications$/, 'Notifications'],
      [/^Theme/, /Theme: /],
    ] as const) {
      fireEvent.focus(screen.getByRole('button', { name }));
      const tip = await screen.findByRole('tooltip');
      expect(tip.textContent).toMatch(text);
      fireEvent.blur(screen.getByRole('button', { name }));
    }
  });

  it('opens the theme menu from the collapsed column', async () => {
    mount({ collapsed: true });
    const trigger = screen.getByRole('button', { name: /^Theme/ });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByRole('menuitemradio', { name: 'Dark' })).toBeTruthy();
  });

  it('calls the palette handler', () => {
    const onPalette = vi.fn();
    mount({ collapsed: true, onPalette });
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    expect(onPalette).toHaveBeenCalled();
  });
});
