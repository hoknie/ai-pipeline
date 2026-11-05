// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtifactsTab } from '../src/components/runs/ArtifactsTab.tsx';
import type { ArtifactView } from '../src/types.ts';

import { fakeApi } from './fixtures.ts';
import { setWindowWidth } from './media.ts';
import { cleanup, fireEvent, render, screen, within } from './render.tsx';

afterEach(() => cleanup());

const artifact = (over: Partial<ArtifactView> = {}): ArtifactView => ({
  id: 'a1',
  step: 'review',
  stepName: 'Ревьюер',
  seq: 2,
  specialist: 'reviewer',
  title: 'Итог ревью',
  fileName: 'report.md',
  size: 1536,
  createdAt: new Date(2026, 0, 10, 14, 32).getTime(),
  preview: 'markdown',
  ...over,
});

function mount(list: ArtifactView[], text = '# Заголовок\n\nтекст') {
  const api = fakeApi({
    groupArtifacts: vi.fn(async () => list),
    artifactText: vi.fn(async () => text),
  });
  const onError = vi.fn();
  render(
    <ArtifactsTab
      api={api}
      runId="run1"
      group="login"
      count={list.length}
      revision={0}
      onError={onError}
    />,
  );
  return { api, onError };
}

describe('artifacts tab', () => {
  it('shows the step, title, file, date and size of an artifact', async () => {
    mount([artifact()]);
    const row = (await screen.findByText('Итог ревью')).closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[0]!.textContent).toBe('Ревьюер · #2');
    expect(cells[0]!.getAttribute('title')).toBe('review · reviewer');
    expect(cells[2]!.querySelector('code')?.textContent).toBe('report.md');
    const time = cells[3]!.querySelector('time')!;
    expect(time.getAttribute('datetime')).toBe(new Date(2026, 0, 10, 14, 32).toISOString());
    expect(time.getAttribute('title')).toBeTruthy();
    expect(cells[4]!.textContent).toBe('1.5 KB');
  });

  it('offers a download for every file and an open button only for a preview', async () => {
    mount([artifact(), artifact({ id: 'a2', fileName: 'data.zip', preview: null, size: 12 })]);
    await screen.findByText('report.md');
    expect(screen.getByRole('button', { name: 'Open report.md' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open data.zip' })).toBeNull();
    const link = screen.getByRole('link', { name: 'Download data.zip' });
    expect(link.getAttribute('href')).toBe('/api/runs/run1/groups/login/artifacts/a2');
    expect(link.hasAttribute('download')).toBe(true);
    expect(screen.getByText('12 B')).toBeTruthy();
  });

  it('renders a markdown artifact as markdown', async () => {
    const restore = setWindowWidth(1600);
    const { api } = mount([artifact()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open report.md' }));
    const heading = await screen.findByRole('heading', { name: 'Заголовок' });
    expect(heading).toBeTruthy();
    expect(api.artifactText).toHaveBeenCalledWith('run1', 'login', 'a1');
    restore();
  });

  it('shows a log as it is', async () => {
    const restore = setWindowWidth(1600);
    mount([artifact({ fileName: 'build.log', preview: 'log' })], '# not a heading\n  x');
    fireEvent.click(await screen.findByRole('button', { name: 'Open build.log' }));
    const pre = await screen.findByText(/# not a heading/);
    expect(pre.tagName).toBe('PRE');
    expect(screen.queryByRole('heading', { name: 'not a heading' })).toBeNull();
    restore();
  });

  it('shows title, file name, download and close in the preview', async () => {
    const restore = setWindowWidth(1600);
    mount([artifact()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open report.md' }));
    const pane = await screen.findByRole('region', { name: 'Preview of report.md' });
    expect(within(pane).getByText('Итог ревью')).toBeTruthy();
    expect(within(pane).getByText('report.md')).toBeTruthy();
    expect(within(pane).getByRole('link', { name: 'Download report.md' })).toBeTruthy();
    fireEvent.click(within(pane).getByRole('button', { name: 'Close preview' }));
    expect(screen.queryByRole('region', { name: 'Preview of report.md' })).toBeNull();
    restore();
  });

  it('does not request a file bigger than the preview limit', async () => {
    const restore = setWindowWidth(1600);
    const { api } = mount([artifact({ size: 2 * 1024 * 1024 })]);
    expect(await screen.findByText('2 MB')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Open report.md' }));
    expect(await screen.findByText(/larger than 1 MB/)).toBeTruthy();
    const previewPane = screen.getByRole('region', { name: 'Preview of report.md' });
    const links = within(previewPane).getAllByRole('link', { name: 'Download report.md' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/api/runs/run1/groups/login/artifacts/a1',
      '/api/runs/run1/groups/login/artifacts/a1',
    ]);
    expect(api.artifactText).not.toHaveBeenCalled();
    restore();
  });

  it('shows a failure to load as text', async () => {
    const restore = setWindowWidth(1600);
    const api = fakeApi({
      groupArtifacts: vi.fn(async () => [artifact()]),
      artifactText: vi.fn(async () => {
        throw new Error('gone');
      }),
    });
    render(
      <ArtifactsTab
        api={api}
        runId="run1"
        group="login"
        count={1}
        revision={0}
        onError={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open report.md' }));
    expect((await screen.findByRole('alert')).textContent).toContain('gone');
    restore();
  });

  it('opens the preview in a dialog on a narrow screen', async () => {
    const restore = setWindowWidth(400);
    mount([artifact()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open report.md' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('heading', { name: 'Заголовок' })).toBeTruthy();
    restore();
  });

  it('reports a failed list', async () => {
    const api = fakeApi({
      groupArtifacts: vi.fn(async () => {
        throw new Error('no list');
      }),
    });
    const onError = vi.fn();
    render(
      <ArtifactsTab
        api={api}
        runId="run1"
        group="login"
        count={1}
        revision={0}
        onError={onError}
      />,
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('no list'));
  });
});
