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

const mount = (
  props: Partial<React.ComponentProps<typeof EntryOverview<Row>>> & { onOpen?: () => void } = {},
) => render(<EntryOverview title="Tester" id="tester" row={row!} onOpen={vi.fn()} {...props} />);

const projectRow = (slug: string) =>
  document.querySelector<HTMLElement>(`[data-overview-project="${slug}"]`)!;

describe('the overview of an entry', () => {
  it('shows a row per project without a description unless one is given', () => {
    mount();
    expect(projectRow('app').textContent).toBe('appProjectOpen in project app');
    expect(within(projectRow('lib')).getByText('Project · overrides shared')).toBeTruthy();
    expect(screen.getByText('To change, choose a project')).toBeTruthy();
    expect(screen.queryByText('Shared level')).toBeNull();
    expect(document.querySelector('[data-overview-shared]')).toBeNull();
  });

  it('puts the description into the row when it is given', () => {
    mount({ describe: (entry: Row) => entry.note });
    expect(within(projectRow('app')).getByText('in app')).toBeTruthy();
    expect(within(projectRow('lib')).getByText('in lib')).toBeTruthy();
  });

  it('opens the entry in the project with its path and does not preview', () => {
    const onOpen = vi.fn();
    const onPreview = vi.fn();
    mount({ onOpen, onPreview });
    fireEvent.click(within(projectRow('lib')).getByRole('button', { name: /Open in project/ }));
    expect(onOpen).toHaveBeenCalledWith('/work/lib');
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('previews the project of a clicked row', () => {
    const onPreview = vi.fn();
    mount({ onPreview });
    fireEvent.click(within(projectRow('lib')).getByRole('button', { name: /^lib/ }));
    expect(onPreview).toHaveBeenCalledWith('lib');
  });

  it('marks the active row', () => {
    mount({ active: 'lib' });
    expect(projectRow('lib').getAttribute('data-active')).toBe('true');
    expect(projectRow('lib').getAttribute('aria-current')).toBe('true');
    expect(projectRow('app').getAttribute('data-active')).toBeNull();
  });

  it('marks the row of the highlighted project', () => {
    mount({ highlight: 'lib' });
    expect(projectRow('lib').getAttribute('data-highlighted')).toBe('true');
    expect(projectRow('app').getAttribute('data-highlighted')).toBeNull();
  });

  it('renders the preview under the list', () => {
    mount({ preview: <p>the preview</p> });
    const text = screen.getByText('the preview');
    const list = document.querySelector('ul')!;
    expect(list.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has nothing to edit', () => {
    mount();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
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
