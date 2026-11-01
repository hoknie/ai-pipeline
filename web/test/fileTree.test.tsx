// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { FileTree } from '../src/components/runs/FileTree.tsx';
import { buildFileTree } from '../src/components/runs/fileTree.ts';

import { cleanup, fireEvent, render, screen } from './render.tsx';

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
