import type { FileStat } from '../../../shared/api/types.ts';

export interface FileNode {
  /** Name shown: a file name or a chain of directories joined with `/`. */
  name: string;
  /** Full path of the file or of the last directory of the chain. */
  path: string;
  kind: 'dir' | 'file';
  added: number;
  removed: number;
  /** A binary file has no line counts. */
  binary: boolean;
  children: FileNode[];
}

interface Draft {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  added: number;
  removed: number;
  binary: boolean;
  children: Map<string, Draft>;
}

function node(name: string, path: string, kind: 'dir' | 'file'): Draft {
  return { name, path, kind, added: 0, removed: 0, binary: false, children: new Map() };
}

function finish(draft: Draft): FileNode {
  let current = draft;
  // A directory holding only one directory is shown together with it: `src/cli/web`.
  while (current.kind === 'dir' && current.children.size === 1) {
    const [only] = current.children.values();
    if (!only || only.kind !== 'dir') break;
    current = { ...only, name: `${current.name}/${only.name}` };
  }
  const children = [...current.children.values()]
    .map(finish)
    .sort((left, right) =>
      left.kind === right.kind
        ? left.name.localeCompare(right.name, 'en')
        : left.kind === 'dir'
          ? -1
          : 1,
    );
  return {
    name: current.name,
    path: current.path,
    kind: current.kind,
    added: current.added,
    removed: current.removed,
    binary: current.binary,
    children,
  };
}

/** Tree of changed files: directories first, single-directory chains merged, line totals summed. */
export function buildFileTree(files: FileStat[]): FileNode[] {
  const root = node('', '', 'dir');
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    const added = file.added ?? 0;
    const removed = file.removed ?? 0;
    let current = root;
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join('/');
      let child = current.children.get(part);
      if (!child) {
        child = node(part, path, last ? 'file' : 'dir');
        current.children.set(part, child);
      }
      child.added += added;
      child.removed += removed;
      if (last) child.binary = file.added === null;
      current = child;
    });
  }
  return [...root.children.values()]
    .map(finish)
    .sort((left, right) =>
      left.kind === right.kind
        ? left.name.localeCompare(right.name, 'en')
        : left.kind === 'dir'
          ? -1
          : 1,
    );
}

/**
 * Rows of table height kept for the diff of a file while it loads, so that the loaded table does
 * not push the content below it: a binary file takes one row, others the changed lines plus the
 * hunk headers and context, within 3 to 40 rows.
 */
export function reservedDiffRows(node: Pick<FileNode, 'added' | 'removed' | 'binary'>): number {
  if (node.binary) return 1;
  return Math.min(40, Math.max(3, node.added + node.removed + 11));
}
