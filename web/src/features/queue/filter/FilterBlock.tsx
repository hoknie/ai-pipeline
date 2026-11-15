import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../shared/ui/layout/collapsible.tsx';

/** The frame of a take filter: a collapsible block with the counter, the help and the reset. */
export function FilterBlock({
  count,
  running,
  locked,
  onReset,
  children,
}: {
  /** How many values are chosen over all fields. */
  count: number;
  /** The queue runs: the fields are locked and the block says so. */
  running: boolean;
  /** The fields and the reset are locked (the queue runs or a change is on its way). */
  locked: boolean;
  onReset: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? count > 0;
  return (
    <Collapsible
      open={expanded}
      onOpenChange={setOpen}
      aria-label={t('queue.filter.label')}
      className="rounded-xl border bg-card p-3"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 font-semibold">
        <span>
          {t('queue.filter.title')}
          {count > 0 ? <span className="ml-2 text-sm text-muted-foreground">{count}</span> : null}
        </span>
        <ChevronDown
          className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t('queue.filter.help')}</p>
        {children}
        {running ? (
          <p className="text-sm text-muted-foreground">{t('queue.filter.locked')}</p>
        ) : null}
        <div>
          <Button variant="outline" disabled={locked || count === 0} onClick={onReset}>
            {t('queue.filter.reset')}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
