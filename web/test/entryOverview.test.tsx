// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EntryOverview, ProjectChips } from '../src/features/repositories/index.ts';
import { groupRows, type ProjectRef } from '../src/shared/lib/catalog/projectRows.ts';
import { cleanup, fireEvent, render, screen, within } from './render.tsx';

afterEach(cleanup);

const ref = (slug: string): ProjectRef => ({
  path: `/work/${slug}`,
  slug,
  label: slug,
  color: null,
});
type Row = { slug: string; level: 'project' | 'global' | 'project_over_global'; note: string };

const [row] = groupRows(
  [
    { project: ref('app'), entries: [{ slug: 'tester', level: 'project', note: 'in app' } as Row] },
    {
      project: ref('lib'),
      entries: [{ slug: 'tester', level: 'project_over_global', note: 'in lib' } as Row],
    },
  ],
  (entry) => entry.slug,
);

const mount = (onOpen = vi.fn(), highlight: string | null = null) =>
  render(
    <EntryOverview
      title="Tester"
      id="tester"
      row={row!}
      highlight={highlight}
      describe={(entry: Row) => entry.note}
      onOpen={onOpen}
    />,
  );

describe('the overview of an entry', () => {
  it('shows a block with the description per project', () => {
    mount();
    const app = document.querySelector<HTMLElement>('[data-overview-project="app"]')!;
    const lib = document.querySelector<HTMLElement>('[data-overview-project="lib"]')!;
    expect(within(app).getByText('in app')).toBeTruthy();
    expect(within(lib).getByText('in lib')).toBeTruthy();
    expect(within(lib).getByText('Project · overrides shared')).toBeTruthy();
    expect(screen.getByText('To change, choose a project')).toBeTruthy();
  });

  it('opens the entry in the project with its path', () => {
    const onOpen = vi.fn();
    mount(onOpen);
    const lib = document.querySelector<HTMLElement>('[data-overview-project="lib"]')!;
    fireEvent.click(within(lib).getByRole('button', { name: /Open in project/ }));
    expect(onOpen).toHaveBeenCalledWith('/work/lib');
  });

  it('marks the block of the highlighted project', () => {
    mount(vi.fn(), 'lib');
    expect(
      document.querySelector('[data-overview-project="lib"]')?.getAttribute('data-highlighted'),
    ).toBe('true');
    expect(
      document.querySelector('[data-overview-project="app"]')?.getAttribute('data-highlighted'),
    ).toBeNull();
  });

  it('has nothing to edit', () => {
    mount();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.getAllByRole('button').every((b) => /Open in project/.test(b.textContent!))).toBe(
      true,
    );
  });
});

describe('the projects under a row', () => {
  it('says «In all projects» for a shared entry everywhere', () => {
    render(<ProjectChips everywhere presences={[]} />);
    expect(screen.getByText('In all projects')).toBeTruthy();
  });

  it('names the projects with the level of their own entries', () => {
    render(<ProjectChips everywhere={false} presences={row!.presences} />);
    expect(screen.getByText('app')).toBeTruthy();
    expect(screen.getByText(/overrides shared/)).toBeTruthy();
  });
});
