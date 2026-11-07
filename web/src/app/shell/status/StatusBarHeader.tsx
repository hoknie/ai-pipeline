import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Connection } from '../../../shared/api/stream.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { CollapsibleTrigger } from '../../../shared/ui/layout/collapsible.tsx';

import { ConnectionIndicator } from './ConnectionIndicator.tsx';

/** The always visible row of the strip: the summary, the toggle and the link state. */
export function StatusBarHeader({
  open,
  summary,
  connection,
}: {
  open: boolean;
  summary: string;
  connection: Connection;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex h-8 min-w-0 flex-1 justify-start gap-2 rounded-none px-4"
          aria-label={t('statusBar.title')}
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          <span className="truncate text-muted-foreground">{summary}</span>
        </Button>
      </CollapsibleTrigger>
      <div className="shrink-0 pr-2">
        <ConnectionIndicator connection={connection} />
      </div>
    </div>
  );
}
