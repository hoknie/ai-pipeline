import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { useBackgroundProcesses } from '../../backgroundProcesses.ts';
import { usePreference } from '../../preferences.ts';
import { loadSections, machineLoad } from '../../specialistLoad.ts';
import type { Connection } from '../../store.ts';
import type { RunView } from '../../types.ts';
import { Button } from '../../ui/button.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs.tsx';

import { BackgroundProcesses } from './BackgroundProcesses.tsx';
import { ConnectionIndicator } from './ConnectionIndicator.tsx';
import { SpecialistLoadPanel } from './SpecialistLoadPanel.tsx';

/** Where a click on a group of the strip leads. */
export interface GroupTarget {
  runId: string;
  group: string;
  step: string | null;
}

type StatusTab = 'specialists' | 'processes';

/** A strip under every section: the load of specialists and background processes, the link with the daemon. */
export function StatusBar({
  runs,
  selected,
  connection,
  api,
  onOpenGroup,
}: {
  runs: RunView[];
  /** The repository selected in the panel; its rows come first. */
  selected: string | null;
  connection: Connection;
  api: Api;
  onOpenGroup: (target: GroupTarget) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = usePreference('specialistLoad.open', false);
  const [tab, setTab] = usePreference<StatusTab>('statusBar.tab', 'specialists');
  const polled = useBackgroundProcesses(api);
  const sections = useMemo(() => loadSections(machineLoad(runs), selected), [runs, selected]);
  const processes = polled.processes === null ? '—' : String(polled.processes.length);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="sticky bottom-0 shrink-0 border-t bg-card text-xs"
      data-testid="status-bar"
    >
      <div className="flex items-center gap-2">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="flex h-8 min-w-0 flex-1 justify-start gap-2 rounded-none px-4"
            aria-label={t('statusBar.title')}
          >
            {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            <span className="truncate text-muted-foreground">
              {t('statusBar.summary', {
                running: sections.running,
                waiting: sections.waiting,
                processes,
              })}
            </span>
          </Button>
        </CollapsibleTrigger>
        <div className="shrink-0 pr-2">
          <ConnectionIndicator connection={connection} />
        </div>
      </div>
      <CollapsibleContent className="max-h-64 overflow-y-auto px-4 pb-3">
        <Tabs value={tab} onValueChange={(value) => setTab(value as StatusTab)}>
          <TabsList>
            <TabsTrigger value="specialists">{t('statusBar.tabSpecialists')}</TabsTrigger>
            <TabsTrigger value="processes">{t('statusBar.tabProcesses')}</TabsTrigger>
          </TabsList>
          <TabsContent value="specialists">
            <SpecialistLoadPanel runs={runs} selected={selected} onOpenGroup={onOpenGroup} />
          </TabsContent>
          <TabsContent value="processes">
            <BackgroundProcesses api={api} polled={polled} onOpenGroup={onOpenGroup} />
          </TabsContent>
        </Tabs>
      </CollapsibleContent>
    </Collapsible>
  );
}
