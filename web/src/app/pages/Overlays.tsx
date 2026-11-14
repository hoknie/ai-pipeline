import type { PanelData } from '../state/usePanelData.ts';
import { CommandPalette } from '../shell/menus/CommandPalette.tsx';
import { ShortcutsDialog } from '../shell/menus/ShortcutsDialog.tsx';
import { NewTaskHost } from './NewTaskHost.tsx';

/** The command palette, the dialog of a new task and the list of shortcuts. */
export function Overlays({ panel }: { panel: PanelData }) {
  const { state, chrome, route, scopedApi } = panel;
  const { newTask } = chrome;
  const { queue, selected, runs } = state;
  const props = {
    ...chrome,
    api: panel.api,
    waiting: panel.waitingRepositories,
    onRoute: panel.setRoute,
    queueDrafts: chrome.drafts.queueDrafts,
    onQueueDraft: chrome.drafts.onQueueDraft,
    palette: chrome.palette,
    onPalette: chrome.setPalette,
    shortcuts: chrome.shortcuts,
    onShortcuts: chrome.setShortcuts,
  };
  return (
    <>
      <CommandPalette
        open={props.palette}
        onOpenChange={props.onPalette}
        api={scopedApi}
        runs={runs}
        route={route}
        onRoute={props.onRoute}
        onShortcuts={() => props.onShortcuts(true)}
      />
      {queue !== null && selected !== null && newTask.opened ? (
        <NewTaskHost
          api={props.api}
          pageKey={selected}
          selected={selected}
          repositories={state.repositories}
          waiting={props.waiting}
          queues={state.queues}
          runs={runs}
          preset={newTask.preset}
          onPresetApplied={() => newTask.setPreset(null)}
          open={newTask.open}
          onOpenChange={newTask.setOpen}
          draft={props.queueDrafts.new}
          onDraft={(draft) => props.onQueueDraft('new', draft)}
          onQueue={state.setQueue}
          onExpand={(repository) => {
            newTask.expand(repository);
            panel.setRoute({ view: 'queue', run: 'new', group: null, step: null, tab: null });
          }}
        />
      ) : null}
      <ShortcutsDialog open={props.shortcuts} onOpenChange={props.onShortcuts} />
    </>
  );
}
