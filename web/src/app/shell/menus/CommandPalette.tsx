import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { requestFocus } from '../../../shared/lib/browser/hotkeys.ts';
import type { Route } from '../../../shared/lib/nav/route.ts';
import type { RunView } from '../../../shared/api/types.ts';
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandList,
} from '../../../shared/ui/overlays/command.tsx';
import {
  ActionsGroup,
  ConfigGroups,
  GroupsGroup,
  LanguageGroup,
  RunsGroup,
  SectionsGroup,
  type Entries,
} from './PaletteGroups.tsx';

/**
 * Palette of commands: sections, runs (waiting ones first), groups, pipelines, specialists,
 * actions and languages. Sections and actions are searched by their labels in the active language.
 */
export function CommandPalette({
  open,
  onOpenChange,
  api,
  runs,
  route,
  onRoute,
  onShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: Api;
  runs: RunView[];
  route: Route;
  onRoute: (route: Route) => void;
  onShortcuts: () => void;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<Entries | null>(null);
  useEffect(() => {
    if (!open || entries) return;
    api.config().then(
      (config) => setEntries({ pipelines: config.pipelines, specialists: config.specialists }),
      () => setEntries({ pipelines: [], specialists: [] }),
    );
  }, [open, entries, api]);

  const go = (next: Route) => {
    onOpenChange(false);
    onRoute(next);
  };
  const to = (view: Route['view'], run: string | null = null): Route => ({
    view,
    run,
    group: null,
    step: null,
    tab: null,
  });
  const openRun = runs.find((candidate) => candidate.id === route.run) ?? null;
  const sorted = [...runs].sort(
    (left, right) => Number(right.state === 'needs_human') - Number(left.state === 'needs_human'),
  );
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t('palette.title')}>
      <CommandInput placeholder={t('palette.placeholder')} />
      <CommandList>
        <CommandEmpty>{t('palette.empty')}</CommandEmpty>
        <SectionsGroup go={go} to={to} />
        <RunsGroup go={go} runs={sorted} />
        {openRun && openRun.groups.length > 1 ? <GroupsGroup go={go} run={openRun} /> : null}
        {entries ? <ConfigGroups go={go} to={to} entries={entries} /> : null}
        <ActionsGroup
          onNewTask={() => {
            go(to('queue'));
            requestFocus('queue-task');
          }}
          onNewTaskPage={() => {
            go({ view: 'queue', run: 'new', group: null, step: null, tab: null });
            requestFocus('new-task-page');
          }}
          onShortcuts={() => {
            onOpenChange(false);
            onShortcuts();
          }}
        />
        <LanguageGroup onChosen={() => onOpenChange(false)} />
      </CommandList>
    </CommandDialog>
  );
}
