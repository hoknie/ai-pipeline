import { useTranslation } from 'react-i18next';

import type { Api } from '../shared/api/api.ts';
import type { RunScope } from '../features/runs/index.ts';
import { AppShell } from './shell/AppShell.tsx';
import { DaemonBanner } from './shell/DaemonBanner.tsx';
import { StatusBar } from './shell/status/StatusBar.tsx';
import { ConfirmProvider } from '../shared/ui/overlays/confirm.tsx';
import { sectionLabel } from './sections.ts';
import { browserEventSource, type EventSourceFactory } from '../shared/api/stream.ts';
import { TagsProvider } from '../shared/lib/catalog/tags.tsx';
import { Overlays } from './pages/Overlays.tsx';
import { PageSwitch } from './pages/PageSwitch.tsx';
import { usePanelData } from './state/usePanelData.ts';
import { usePanelNav } from './state/usePanelNav.ts';
import { useRepositoryActions } from './state/useRepositoryActions.ts';

/** The panel: the confirmation dialog wraps it, so a repository switch can ask first. */
export function App(props: { api: Api; openStream?: EventSourceFactory }) {
  return (
    <ConfirmProvider>
      <Panel {...props} />
    </ConfirmProvider>
  );
}

function Panel({
  api,
  openStream = browserEventSource,
}: {
  api: Api;
  openStream?: EventSourceFactory;
}) {
  const { t } = useTranslation();
  const panel = usePanelData(api, openStream);
  const { state, route, setRoute } = panel;
  const actions = useRepositoryActions(panel);
  const nav = usePanelNav(panel, actions);
  return (
    <TagsProvider tags={state.tags} onTags={state.setTags}>
      <AppShell
        footer={
          <StatusBar
            runs={state.runs}
            selected={state.selected}
            connection={state.connection}
            streamedProcesses={state.streamedProcesses}
            api={api}
            onOpenGroup={(entry) =>
              setRoute({
                view: 'runs',
                run: entry.runId,
                group: entry.group,
                step: entry.step,
                tab: null,
              })
            }
          />
        }
        nav={nav}
      >
        <Overlays panel={panel} />
        <DaemonBanner daemon={state.daemon} />
        <h1 className="sr-only">{sectionLabel(route.view, t)}</h1>
        <PageSwitch panel={panel} actions={actions} />
      </AppShell>
    </TagsProvider>
  );
}
