import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { useBackgroundProcesses } from './backgroundProcesses.ts';
import { usePreference } from '../../../shared/lib/browser/preferences.ts';
import { useStatusBarHeight } from './statusBarHeight.ts';
import { loadSections, machineLoad } from '../../../shared/lib/pipeline/specialistLoad.ts';
import type { Connection } from '../../../shared/api/stream.ts';
import type { StreamedProcesses } from '../../../shared/api/runs/runsState.ts';
import type { RunView } from '../../../shared/api/types.ts';
import { Collapsible, CollapsibleContent } from '../../../shared/ui/layout/collapsible.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../shared/ui/layout/tabs.tsx';

import { BackgroundProcesses } from './BackgroundProcesses.tsx';
import { StatusBarHeader } from './StatusBarHeader.tsx';
import { SpecialistLoadPanel } from './SpecialistLoadPanel.tsx';
import { StatusBarResizeHandle } from './StatusBarResizeHandle.tsx';

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
  streamedProcesses = null,
  api,
  onOpenGroup,
}: {
  runs: RunView[];
  /** The repository selected in the panel; its rows come first. */
  selected: string | null;
  connection: Connection;
  /** What the event stream last said about background processes. */
  streamedProcesses?: StreamedProcesses | null;
  api: Api;
  onOpenGroup: (target: GroupTarget) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = usePreference('specialistLoad.open', false);
  const [tab, setTab] = usePreference<StatusTab>('statusBar.tab', 'specialists');
  const size = useStatusBarHeight();
  const [preview, setPreview] = useState<number | null>(null);
  const polled = useBackgroundProcesses(api, streamedProcesses, connection);
  const sections = useMemo(() => loadSections(machineLoad(runs), selected), [runs, selected]);
  const processes = polled.processes === null ? '—' : String(polled.processes.length);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="sticky bottom-0 shrink-0 border-t bg-card text-xs"
      data-testid="status-bar"
    >
      {open ? (
        <StatusBarResizeHandle
          height={preview ?? size.height}
          chosen={size.chosen}
          viewportHeight={size.viewportHeight}
          onPreview={setPreview}
          onCommit={size.setChosen}
        />
      ) : null}
      <StatusBarHeader
        open={open}
        summary={t('statusBar.summary', {
          running: sections.running,
          waiting: sections.waiting,
          processes,
        })}
        connection={connection}
      />
      <CollapsibleContent
        className="flex flex-col px-4 pb-3"
        style={{ height: preview ?? size.height }}
        data-testid="status-bar-content"
      >
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as StatusTab)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsList className="shrink-0">
            <TabsTrigger value="specialists">{t('statusBar.tabSpecialists')}</TabsTrigger>
            <TabsTrigger value="processes">{t('statusBar.tabProcesses')}</TabsTrigger>
          </TabsList>
          <TabsContent value="specialists" className="min-h-0 flex-1 overflow-y-auto pt-3">
            <SpecialistLoadPanel runs={runs} selected={selected} onOpenGroup={onOpenGroup} />
          </TabsContent>
          <TabsContent value="processes" className="min-h-0 flex-1 overflow-y-auto">
            <BackgroundProcesses api={api} polled={polled} onOpenGroup={onOpenGroup} />
          </TabsContent>
        </Tabs>
      </CollapsibleContent>
    </Collapsible>
  );
}
