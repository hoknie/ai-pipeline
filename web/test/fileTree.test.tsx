// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileTree } from '../src/components/runs/FileTree.tsx';
import { buildFileTree } from '../src/components/runs/fileTree.ts';

import { fakeApi } from './fixtures.ts';
import { cleanup, fireEvent, render, screen, waitFor } from './render.tsx';

afterEach(() => cleanup());

const files = [
  { path: 'src/cli/web/server.ts', added: 300, removed: 0 },
  { path: 'src/cli/web/index.ts', added: 66, removed: 0 },
  { path: 'README.md', added: 5, removed: 1 },
  { path: 'assets/logo.png', added: null, removed: null },
];

describe('buildFileTree', () => {
  it('merges a chain of single directories and sums the lines', () => {
    const tree = buildFileTree(files);
    expect(tree.map((node) => node.name)).toEqual(['assets', 'src/cli/web', 'README.md']);
    const web = tree[1]!;
    expect(web).toMatchObject({ kind: 'dir', path: 'src/cli/web', added: 366, removed: 0 });
    expect(web.children.map((node) => node.name)).toEqual(['index.ts', 'server.ts']);
  });

  it('keeps a binary file without line counts', () => {
    const logo = buildFileTree(files)[0]!.children[0]!;
    expect(logo).toMatchObject({ name: 'logo.png', binary: true, added: 0, removed: 0 });
  });

  it('keeps a directory with several children and lists directories before files', () => {
    const tree = buildFileTree([
      { path: 'a/x.ts', added: 1, removed: 0 },
      { path: 'a/b/y.ts', added: 2, removed: 1 },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: 'a', added: 3, removed: 1 });
    expect(tree[0]!.children.map((node) => node.name)).toEqual(['b', 'x.ts']);
  });

  it('is empty for no files', () => {
    expect(buildFileTree([])).toEqual([]);
  });
});

describe('FileTree', () => {
  it('shows the totals of a directory and folds it', () => {
    render(<FileTree files={files} />);
    const dir = screen.getByRole('button', { name: /src\/cli\/web/ });
    expect(dir.textContent).toContain('+366');
    expect(screen.getByText('server.ts')).toBeTruthy();
    fireEvent.click(dir);
    expect(screen.queryByText('server.ts')).toBeNull();
    expect(screen.getByText('binary')).toBeTruthy();
  });
});

describe('FileTree with diffs', () => {
  const small = [
    { path: 'a.ts', added: 1, removed: 1 },
    { path: 'b.ts', added: 2, removed: 0 },
    { path: 'logo.png', added: null, removed: null },
    { path: 'new.ts', added: 0, removed: 0, previousPath: 'old.ts' },
  ];
  const source = (api = fakeApi(), version = 'v1') => ({
    api,
    runId: 'run1',
    group: 'login',
    version,
  });

  it('opens the diff of a file on a click, with line numbers, and closes it without a request', async () => {
    const api = fakeApi();
    render(<FileTree files={small} diff={source(api)} />);
    const button = screen.getByRole('button', { name: 'a.ts' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await screen.findByText('new');
    expect(api.fileDiff).toHaveBeenCalledWith('run1', 'login', 'a.ts');
    expect(screen.getByText('@@ -1,2 +1,2 @@')).toBeTruthy();
    fireEvent.click(button);
    expect(screen.queryByText('new')).toBeNull();
    fireEvent.click(button);
    await screen.findByText('new');
    expect(api.fileDiff).toHaveBeenCalledTimes(1);
  });

  it('keeps several files open at once', async () => {
    const api = fakeApi();
    render(<FileTree files={small} diff={source(api)} />);
    fireEvent.click(screen.getByRole('button', { name: 'a.ts' }));
    fireEvent.click(screen.getByRole('button', { name: 'b.ts' }));
    await waitFor(() => expect(screen.getAllByText('new')).toHaveLength(2));
  });

  it('asks again after the changes of the group changed', async () => {
    const api = fakeApi();
    const { rerender } = render(<FileTree files={small} diff={source(api)} />);
    fireEvent.click(screen.getByRole('button', { name: 'a.ts' }));
    await screen.findByText('new');
    rerender(<FileTree files={small} diff={source(api, 'v2')} />);
    await waitFor(() => expect(api.fileDiff).toHaveBeenCalledTimes(2));
  });

  it('says so for a binary file and when the diff is not available', async () => {
    const api = fakeApi({
      fileDiff: vi.fn(async (_run: string, _group: string, path: string) => {
        if (path === 'a.ts') throw new Error('the diff of a.ts is not available');
        return {
          path,
          previousPath: null,
          binary: true,
          lines: [],
          totalLines: 0,
          truncated: false,
        };
      }),
    });
    render(<FileTree files={small} diff={source(api)} />);
    fireEvent.click(screen.getByRole('button', { name: 'logo.png' }));
    await screen.findByText('Binary file: no diff to show.');
    fireEvent.click(screen.getByRole('button', { name: 'a.ts' }));
    await screen.findByText(/The diff is not available: the diff of a.ts is not available/);
  });

  it('marks a truncated diff and shows the old path of a rename', async () => {
    const api = fakeApi({
      fileDiff: vi.fn(async (_run: string, _group: string, path: string) => ({
        path,
        previousPath: null,
        binary: false,
        lines: ['@@ -1 +1 @@', '-a', '+b'],
        totalLines: 5000,
        truncated: true,
      })),
    });
    render(<FileTree files={small} diff={source(api)} />);
    expect(screen.getByText('was old.ts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'new.ts' }));
    await screen.findByText('Showing 3 of 5000 lines.');
  });
});
