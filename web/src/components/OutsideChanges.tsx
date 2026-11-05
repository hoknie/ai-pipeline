import { ChevronRight, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { FilePath } from './FilePath.tsx';
import type { AttemptView } from '../types.ts';
import { Button } from '../ui/button.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.tsx';

const COLLAPSE_ABOVE = 5;

/** Files of the main working copy that changed while a step ran; a long list starts collapsed. */
export function OutsideChanges({
  attempt,
  onDismiss,
}: {
  attempt: AttemptView;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const list = attempt.outsideChanges ?? [];
  if (list.length === 0) return null;
  return (
    <Collapsible
      defaultOpen={list.length <= COLLAPSE_ABOVE}
      className="rounded-lg border border-status-warn/30 bg-status-warn-bg text-sm text-status-warn"
    >
      <div className="flex items-center">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left">
          <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
          <TriangleAlert className="size-4" aria-hidden />
          {t('runs.outside.title', {
            step: attempt.stepName ?? attempt.stepId,
            seq: attempt.seq,
            count: list.length,
          })}
        </CollapsibleTrigger>
        {onDismiss ? (
          <Button
            variant="ghost"
            size="icon"
            className="mr-1 size-7 shrink-0"
            aria-label={t('runs.group.dismissNotice')}
            title={t('runs.group.dismissNotice')}
            onClick={onDismiss}
          >
            <X />
          </Button>
        ) : null}
      </div>
      <CollapsibleContent>
        <p className="px-8 pb-1 text-xs">{t('runs.outside.hint')}</p>
        <ul className="px-8 pb-2">
          {list.map((file) => (
            <li key={file}>
              <FilePath path={file} />
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
