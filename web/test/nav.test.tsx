// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NotificationCenterState } from '../src/app/notifications.ts';
import { NavSidebar, type NavProps } from '../src/app/shell/nav/NavSidebar.tsx';
import { MobileNav } from '../src/app/shell/nav/MobileNav.tsx';
import { AppShell } from '../src/app/shell/AppShell.tsx';
import { TopNav } from '../src/app/shell/nav/TopNav.tsx';
import { TooltipProvider } from '../src/shared/ui/feedback/tooltip.tsx';

import { cleanup, fireEvent, render, screen, within } from './render.tsx';

afterEach(() => cleanup());

export function centre(extra: Partial<NotificationCenterState> = {}): NotificationCenterState {
  return {
    items: [],
    unread: 0,
    unreadTone: 'err',
    isRead: () => false,
    permission: 'default',
    open: () => {},
    enable: () => {},
    hide: () => {},
    hideAll: () => {},
    select: () => {},
    ...extra,
  };
}

function props(extra: Partial<NavProps> = {}): NavProps {
  return {
    view: 'runs',
    hrefFor: (view) => `#${view}`,
    onNavigate: () => {},
    working: 0,
    waiting: 0,
    queued: 0,
    onPalette: () => {},
    notifications: centre(),
    repository: {
      repositories: [],
      selected: null,
      waiting: new Map(),
      home: null,
      onSelect: () => {},
      onAdd: async () => {},
      onRemove: () => {},
      browse: async () => ({
        path: '/home/me',
        parent: '/home',
        home: '/home/me',
        git: false,
        entries: [],
        truncated: false,
      }),
    },
    ...extra,
  };
}

function mount(extra: Partial<NavProps> = {}) {
  return render(
    <TooltipProvider>
      <TopNav {...props(extra)} />
    </TooltipProvider>,
  );
}

describe('top navigation', () => {
  it('puts the name and repository, the sections and the tools in one strip', () => {
    const { container } = mount();
    const bar = container.querySelector('header');
    expect(bar).not.toBeNull();
    const nav = screen.getByRole('navigation', { name: 'sections' });
    expect(bar!.contains(nav)).toBe(true);
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Runs', 'Queue', 'Specialists', 'Pipeline', 'Settings']);
    expect(within(bar!).getByText('web')).toBeTruthy();
    expect(within(bar!).getByRole('button', { name: 'Add repository…' })).toBeTruthy();
    for (const name of [/Command palette/, /^Notifications$/, /^Language/, /^Theme/])
      expect(within(bar!).getByRole('button', { name })).toBeTruthy();
    expect(within(bar!).queryByRole('status', { name: /link with the daemon/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /navigation/i })).toBeNull();
    expect(bar!.className).not.toContain('flex-wrap');
  });

  it('shows an icon and a label for each section and marks the current one', () => {
    mount({ view: 'queue' });
    const nav = screen.getByRole('navigation', { name: 'sections' });
    for (const link of within(nav).getAllByRole('link')) {
      expect(link.querySelector('svg')).not.toBeNull();
      expect(link.querySelector('span.sr-only')?.textContent).toBe(link.textContent);
    }
    expect(within(nav).getByRole('link', { name: 'Queue' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Runs' }).getAttribute('aria-current')).toBeNull();
  });

  it('marks the settings section as current', () => {
    mount({ view: 'settings' });
    const nav = screen.getByRole('navigation', { name: 'sections' });
    expect(within(nav).getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Runs' }).getAttribute('aria-current')).toBeNull();
  });

  it('navigates by the section links', () => {
    const onNavigate = vi.fn();
    mount({ onNavigate });
    fireEvent.click(screen.getByRole('link', { name: 'Pipeline' }));
    expect(onNavigate).toHaveBeenCalledWith('pipelines');
  });

  const corner = () => document.querySelector<HTMLElement>('[data-nav-icon] .absolute');

  it('shows the runs in progress in the run tone beside the label and on the icon corner', () => {
    mount({ working: 3 });
    const badges = screen.getAllByLabelText('running: 3');
    expect(badges).toHaveLength(2);
    const side = badges.find((b) => !b.closest('[data-nav-icon]'));
    expect(side?.textContent).toBe('3');
    expect(side?.className).toContain('status-run');
    expect(side?.className).toContain('hidden lg:inline-flex');
    expect(corner()?.textContent).toBe('3');
    expect(corner()?.className).toContain('lg:hidden');
    expect(corner()?.getAttribute('aria-label')).toBe('running: 3');
    expect(corner()?.hasAttribute('aria-hidden')).toBe(false);
    expect(screen.queryByLabelText(/waiting for an answer/)).toBeNull();
  });

  it('shows a second counter of the runs waiting for an answer', () => {
    mount({ working: 3, waiting: 2 });
    const badges = screen.getAllByLabelText('running: 3, waiting for an answer: 2');
    expect(badges).toHaveLength(2);
    for (const b of badges) {
      expect(b.className).toContain('status-warn');
      expect(b.textContent).toBe('3');
    }
    expect(corner()?.getAttribute('aria-label')).toBe('running: 3, waiting for an answer: 2');
    expect(corner()?.hasAttribute('aria-hidden')).toBe(false);
    const second = screen.getByLabelText('waiting for an answer: 2');
    expect(second.textContent).toBe('2');
    expect(second.className).toContain('status-warn');
    expect(second.className).toContain('hidden lg:inline-flex');
    expect(second.closest('[data-nav-icon]')).toBeNull();
    expect(document.querySelectorAll('[data-nav-icon] .absolute')).toHaveLength(1);
  });

  it('shows the queue counter and shortens a large one on the icon corner', () => {
    mount({ queued: 3 });
    expect(screen.getAllByLabelText('in the queue: 3')).toHaveLength(2);
    expect(corner()?.textContent).toBe('3');
    expect(corner()?.getAttribute('aria-label')).toBe('in the queue: 3');
    expect(corner()?.hasAttribute('aria-hidden')).toBe(false);
    cleanup();
    mount({ queued: 150, working: 150 });
    expect(screen.getAllByLabelText('in the queue: 150')[1]?.textContent).toBe('150');
    expect(screen.getAllByLabelText('running: 150')[1]?.textContent).toBe('150');
    expect(
      [...document.querySelectorAll('[data-nav-icon] .absolute')].map((n) => n.textContent),
    ).toEqual(['99+', '99+']);
  });

  it('shows no counters without runs and queued tasks', () => {
    const { container } = mount();
    expect(
      container.querySelectorAll('[aria-label^="running"], [aria-label^="in the queue"]'),
    ).toHaveLength(0);
    expect(container.querySelectorAll('[data-nav-icon] .absolute')).toHaveLength(0);
  });

  it('gives the new task button the height of the search button', () => {
    mount({ onNewTask: vi.fn() });
    const bar = screen.getByRole('banner');
    const button = within(bar).getByRole('button', { name: 'New task' });
    const palette = within(bar).getByRole('button', { name: 'Command palette' });
    expect(button.classList.contains('size-7')).toBe(true);
    expect(button.classList.contains('size-8')).toBe(false);
    expect(palette.classList.contains('h-7')).toBe(true);
    expect(button.querySelector('svg')).toBeTruthy();
    expect(palette.querySelector('svg')).toBeTruthy();
  });

  it('puts the new task button right before the search and disables it without a handler', () => {
    const onNewTask = vi.fn();
    const { rerender } = mount({ onNewTask });
    const bar = screen.getByRole('banner');
    const button = within(bar).getByRole<HTMLButtonElement>('button', { name: 'New task' });
    const palette = within(bar).getByRole('button', { name: 'Command palette' });
    expect(button.compareDocumentPosition(palette) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.parentElement).toBe(palette.parentElement);
    expect(button.nextElementSibling).toBe(palette);
    fireEvent.click(button);
    expect(onNewTask).toHaveBeenCalledTimes(1);
    rerender(
      <TooltipProvider>
        <TopNav {...props()} />
      </TooltipProvider>,
    );
    expect(
      within(screen.getByRole('banner')).getByRole<HTMLButtonElement>('button', {
        name: 'New task',
      }).disabled,
    ).toBe(true);
  });

  it('names the icon buttons in tooltips', async () => {
    mount();
    for (const [name, text] of [
      [/^New task$/, 'New task'],
      [/Command palette/, 'Search and commands'],
      [/^Notifications$/, 'Notifications'],
      [/^Language/, /Language: /],
      [/^Theme/, /Theme: /],
    ] as const) {
      fireEvent.focus(screen.getByRole('button', { name }));
      const tip = await screen.findByRole('tooltip');
      expect(tip.textContent).toMatch(text);
      fireEvent.blur(screen.getByRole('button', { name }));
    }
  });

  it.each(['default', 'granted', 'denied', 'unsupported'] as const)(
    'always shows the notifications button (permission %s)',
    (permission) => {
      mount({ notifications: centre({ permission }) });
      expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
    },
  );

  it('puts the unread count on the bell and into its name', () => {
    const { container } = mount({ notifications: centre({ unread: 3, unreadTone: 'warn' }) });
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeTruthy();
    expect(container.querySelector('[data-notification-count]')!.textContent).toBe('3');
  });

  it('shortens a large count to 99+', () => {
    const { container } = mount({ notifications: centre({ unread: 150 }) });
    expect(container.querySelector('[data-notification-count]')!.textContent).toBe('99+');
    expect(screen.getByRole('button', { name: 'Notifications, 150 unread' })).toBeTruthy();
  });

  it('shows no count when everything is read', () => {
    const { container } = mount();
    expect(container.querySelector('[data-notification-count]')).toBeNull();
  });

  it('opens the theme menu', async () => {
    mount();
    fireEvent.keyDown(screen.getByRole('button', { name: /^Theme/ }), { key: 'Enter' });
    expect(await screen.findByRole('menuitemradio', { name: 'Dark' })).toBeTruthy();
  });

  it('calls the palette handler', () => {
    const onPalette = vi.fn();
    mount({ onPalette });
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    expect(onPalette).toHaveBeenCalled();
  });

  it('ignores a navigation collapsed by an older version', () => {
    window.localStorage.setItem('aip.web.navCollapsed', 'true');
    mount();
    expect(
      screen.getByRole('link', { name: 'Runs' }).querySelector('.lg\\:not-sr-only'),
    ).not.toBeNull();
    expect(screen.queryByRole('button', { name: /navigation/i })).toBeNull();
    window.localStorage.removeItem('aip.web.navCollapsed');
  });
});

describe('navigation panel of a narrow window', () => {
  it('lists the sections with full counters and without collapsing', () => {
    render(
      <TooltipProvider>
        <NavSidebar {...props({ working: 3, waiting: 2, queued: 150 })} />
      </TooltipProvider>,
    );
    const nav = screen.getByRole('navigation', { name: 'sections' });
    expect(within(nav).getByText('Runs')).toBeTruthy();
    expect(screen.getByLabelText('in the queue: 150').textContent).toBe('150');
    expect(screen.getByLabelText('running: 3, waiting for an answer: 2')).toBeTruthy();
    expect(screen.getByLabelText('waiting for an answer: 2').textContent).toBe('2');
    expect(screen.queryByRole('button', { name: /navigation/i })).toBeNull();
    for (const row of document.querySelectorAll('[data-nav-row]'))
      expect(row.classList.contains('justify-start')).toBe(true);
  });
});

describe('menu on a phone', () => {
  it('has the new task button in the menu row, outside the sliding panel', () => {
    const onNewTask = vi.fn();
    render(
      <TooltipProvider>
        <MobileNav {...props({ onNewTask })} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    expect(onNewTask).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the navigation panel with every control and closes it on a jump', async () => {
    const onNavigate = vi.fn();
    render(
      <TooltipProvider>
        <MobileNav {...props({ working: 2, queued: 1, onNavigate })} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('navigation', { name: 'sections' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Add repository…' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Command palette' })).toBeTruthy();
    expect(within(dialog).getByLabelText('running: 2')).toBeTruthy();
    expect(within(dialog).getByLabelText('in the queue: 1')).toBeTruthy();
    for (const name of [/^Notifications$/, /^Language/, /^Theme/])
      expect(within(dialog).getByRole('button', { name })).toBeTruthy();
    expect(within(dialog).queryByRole('status', { name: /link with the daemon/ })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /navigation/i })).toBeNull();
    fireEvent.click(within(dialog).getByRole('link', { name: /Queue/ }));
    expect(onNavigate).toHaveBeenCalledWith('queue');
  });
});

describe('scrolling of the shell', () => {
  it('keeps the page from scrolling under the footer', () => {
    render(
      <AppShell nav={props()} footer={<div data-testid="footer" />}>
        <div data-testid="content" />
      </AppShell>,
    );
    const root = screen.getByTestId('content').closest('.h-dvh');
    expect(root?.classList.contains('overflow-hidden')).toBe(true);
    expect(root?.classList.contains('relative')).toBe(true);
    const area = screen.getByTestId('content').parentElement!;
    expect(area.classList.contains('relative')).toBe(true);
    expect(area.classList.contains('overflow-y-auto')).toBe(true);
    expect(area.classList.contains('overscroll-contain')).toBe(true);
  });
});
