import { ChevronRight, File, Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/cn.ts';
import type { FileStat } from '../../types.ts';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible.tsx';

import { buildFileTree, type FileNode } from './fileTree.ts';

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

function Row({ node }: { node: FileNode }) {
  if (node.kind === 'file') {
    return (
      <li className="flex items-center justify-between gap-3 px-2 py-1 text-sm">
        <span className="flex min-w-0 items-center gap-1.5">
          <File className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <code className="truncate font-mono text-xs" title={node.path}>
            {node.name}
          </code>
        </span>
        <Counts node={node} />
      </li>
    );
  }
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
              <Row key={child.path} node={child} />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/** Changed files of a group as a tree with line counts. */
export function FileTree({ files }: { files: FileStat[] }) {
  const { t } = useTranslation();
  const tree = buildFileTree(files);
  return (
    <ul aria-label={t('runs.files.label')} className="rounded-lg border bg-card p-1">
      {tree.map((node) => (
        <Row key={node.path} node={node} />
      ))}
    </ul>
  );
}
