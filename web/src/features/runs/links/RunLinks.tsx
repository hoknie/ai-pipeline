import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { RunView, TaskLinkView } from '../../../shared/api/types.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { notifyError } from '../../../shared/lib/browser/notify.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../shared/ui/layout/collapsible.tsx';
import { Dialog, DialogContent, DialogTitle } from '../../../shared/ui/overlays/dialog.tsx';
import { LinkChips } from './LinkChips.tsx';
import { LinksEditor, type LinkRow } from './LinksEditor.tsx';
import type { LinkKind } from './linkKinds.ts';
import type { LinkTargetGroup } from './linkTargets.ts';

export type RunLinkChoices = (kind: LinkKind) => LinkTargetGroup[];

/** The «Добавить связь» dialog: one editor row without «Блокируется», an error stays inside. */
function AddDialog({
  run,
  api,
  choices,
  open,
  onOpenChange,
}: {
  run: RunView;
  api: Api;
  choices: RunLinkChoices | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [row, setRow] = useState<LinkRow>({ kind: 'related', target: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setRow({ kind: 'related', target: '' });
      setError(null);
    }
  }, [open, run.id]);
  const add = async () => {
    if (!row.target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.taskLink(run.id, row.kind, row.target);
      onOpenChange(false);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>{t('links.add')}</DialogTitle>
        <LinksEditor
          value={[row]}
          onChange={(rows) => setRow(rows[0] ?? { kind: 'related', target: '' })}
          choices={choices ?? (() => [])}
          addButton={false}
          editableKinds={
            run.links.some((link) => link.kind === 'parent')
              ? ['related', 'duplicates']
              : ['parent', 'related', 'duplicates']
          }
        />
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <Button disabled={busy || !row.target || !choices} onClick={() => void add()}>
          {t('links.add')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** The two vertical blocks: the links of the task and the links that point to it. */
function LinksBlocks({
  run,
  onProject,
  onRemove,
}: {
  run: RunView;
  onProject: ((path: string) => void) | undefined;
  onRemove: (link: TaskLinkView) => void;
}) {
  const { t } = useTranslation();
  const blocks = [
    { key: 'outgoing' as const, links: run.links, linkedBy: [] },
    { key: 'incoming' as const, links: [], linkedBy: run.linkedBy },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {blocks.map((block) => (
        <div key={block.key} className="flex min-w-0 flex-col gap-2 rounded-md border p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(`links.${block.key}`)}
          </h3>
          {block.links.length || block.linkedBy.length ? (
            <div className="flex min-w-0 flex-col gap-2 text-xs">
              <LinkChips
                links={block.links}
                linkedBy={block.linkedBy}
                repository={run.repository}
                onProject={onProject}
                linkItems
                onRemove={onRemove}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('links.none')}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/** A collapsible overview under a rule: the outgoing and the incoming links. */
function LinksSection({
  run,
  onProject,
  onRemove,
}: {
  run: RunView;
  onProject: ((path: string) => void) | undefined;
  onRemove: (link: TaskLinkView) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const count = run.links.length + run.linkedBy.length;
  if (count === 0) return null;
  return (
    <section aria-label={t('links.title')} className="mt-3 border-t pt-3">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium">
          <ChevronRight
            aria-hidden
            className={cn('size-4 transition-transform', expanded && 'rotate-90')}
          />
          {t('links.title')}
          <span className="text-xs font-normal text-muted-foreground">{count}</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <LinksBlocks run={run} onProject={onProject} onRemove={onRemove} />
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

/** Existing links remain visible even when the run's queue is unavailable. */
export function RunLinks({
  run,
  api,
  choices,
  open,
  onOpenChange,
  onProject,
}: {
  run: RunView;
  api: Api;
  choices?: RunLinkChoices | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProject?: ((path: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  const remove = async (link: TaskLinkView) => {
    try {
      await api.taskUnlink(run.id, link.kind, link.id);
    } catch (failure) {
      notifyError(failure);
    }
  };
  return (
    <>
      <LinksSection run={run} onProject={onProject} onRemove={(link) => void remove(link)} />
      <AddDialog run={run} api={api} choices={choices} open={open} onOpenChange={onOpenChange} />
    </>
  );
}
