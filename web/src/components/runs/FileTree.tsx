import { ChevronRight, File, Folder } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { cn } from '../../lib/cn.ts';
import type { FileStat } from '../../types.ts';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible.tsx';

import { FileDiff, type FileDiffState } from './FileDiff.tsx';
import { buildFileTree, type FileNode } from './fileTree.ts';

/** What the tree needs to show the diff of a file when it is clicked. */
export interface DiffSource {
  api: Api;
  runId: string;
  group: string;
  /** Changes with the statistics of the group; loaded diffs are dropped when it changes. */
  version: string;
}

interface Expansion {
  open: Set<string>;
  results: Record<string, FileDiffState>;
  previous: Map<string, string>;
  toggle: (path: string) => void;
}

function Counts({ node }: { node: FileNode }) {
  const { t } = useTranslation();
  if (node.binary) return <span className="text-muted-foreground">{t('runs.files.binary')}</span>;
  return (
    <span className="font-mono text-xs">
      <span className="text-status-ok">+{node.added}</span>{' '}
      <span className="text-status-err">−{node.removed}</span>
    </span>
  );
}

function FileRow({ node, expansion }: { node: FileNode; expansion: Expansion | null }) {
  const { t } = useTranslation();
  const label = (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        {expansion ? (
          <ChevronRight
            className={cn(
              'size-4 shrink-0 transition-transform',
              expansion.open.has(node.path) && 'rotate-90',
            )}
            aria-hidden
          />
        ) : null}
        <File className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <code className="truncate font-mono text-xs" title={node.path}>
          {node.name}
        </code>
        {expansion?.previous.has(node.path) ? (
          <span className="truncate text-xs text-muted-foreground">
            {t('runs.files.renamedFrom', { path: expansion.previous.get(node.path) ?? '' })}
          </span>
        ) : null}
      </span>
      <Counts node={node} />
    </>
  );
  if (!expansion) {
    return <li className="flex items-center justify-between gap-3 px-2 py-1 text-sm">{label}</li>;
  }
  const isOpen = expansion.open.has(node.path);
  const result = expansion.results[node.path];
  return (
    <li>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label={node.path}
        onClick={() => expansion.toggle(node.path)}
        className="flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left text-sm hover:bg-accent"
      >
        {label}
      </button>
      {isOpen ? (
        <div className="my-1 ml-2 overflow-hidden rounded border">
          <FileDiff result={result ?? { state: 'loading' }} />
        </div>
      ) : null}
    </li>
  );
}

function Row({ node, expansion }: { node: FileNode; expansion: Expansion | null }) {
  if (node.kind === 'file') return <FileRow node={node} expansion={expansion} />;
  return (
    <li>
      <Collapsible defaultOpen>
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-sm hover:bg-accent">
          <span className="flex min-w-0 items-center gap-1.5">
            <ChevronRight
              className={cn(
                'size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90',
              )}
              aria-hidden
            />
            <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <code className="truncate font-mono text-xs">{node.name}</code>
          </span>
          <Counts node={node} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="ml-4 border-l pl-1">
            {node.children.map((child) => (
              <Row key={child.path} node={child} expansion={expansion} />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/**
 * Changed files of a group as a tree with line counts. With a `diff` source a click on a file
 * opens its diff below it; opened diffs are kept until the changes of the group change.
 */
export function FileTree({ files, diff }: { files: FileStat[]; diff?: DiffSource }) {
  const { t } = useTranslation();
  const tree = buildFileTree(files);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, FileDiffState>>({});
  const requested = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const api = diff?.api;
  const runId = diff?.runId;
  const group = diff?.group;
  const version = diff?.version;
  useEffect(() => {
    if (!api || runId === undefined || group === undefined) return;
    for (const path of open) {
      const key = `${version}\u0000${path}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      const settle = (state: FileDiffState) => {
        if (alive.current) setResults((current) => ({ ...current, [key]: state }));
      };
      api.fileDiff(runId, group, path).then(
        (loaded) => settle({ state: 'ready', diff: loaded }),
        (failure: Error) => {
          requested.current.delete(key);
          settle({ state: 'error', message: failure.message });
        },
      );
    }
  }, [open, api, runId, group, version]);

  if (!diff) {
    return (
      <ul aria-label={t('runs.files.label')} className="rounded-lg border bg-card p-1">
        {tree.map((node) => (
          <Row key={node.path} node={node} expansion={null} />
        ))}
      </ul>
    );
  }
  const expansion: Expansion = {
    open,
    results: Object.fromEntries(
      [...open].map((path) => [
        path,
        results[`${version}\u0000${path}`] ?? ({ state: 'loading' } as const),
      ]),
    ),
    previous: new Map(
      files.flatMap((file) => (file.previousPath ? [[file.path, file.previousPath] as const] : [])),
    ),
    toggle: (path) =>
      setOpen((current) => {
        const next = new Set(current);
        if (!next.delete(path)) next.add(path);
        return next;
      }),
  };
  return (
    <ul aria-label={t('runs.files.label')} className="rounded-lg border bg-card p-1">
      {tree.map((node) => (
        <Row key={node.path} node={node} expansion={expansion} />
      ))}
    </ul>
  );
}
