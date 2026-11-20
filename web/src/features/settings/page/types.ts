import type { RefObject } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ObserversView } from '../../../shared/api/observerTypes.ts';
import type {
  NetworkStatus,
  QueueView,
  RepositoryView,
  RunView,
} from '../../../shared/api/types.ts';
import type { SwarmTarget } from '../../swarm/index.ts';
import type {
  ObserverTab,
  SettingsGroup,
  SettingsScope,
} from '../../../shared/lib/nav/settingsGroups.ts';

export interface SettingsPageProps {
  api: Api;
  scope: SettingsScope;
  group: SettingsGroup;
  /** The place of the window of the group «Swarm»: its tab and the open entry. */
  swarm: SwarmTarget;
  onSelectSwarm: (target: SwarmTarget) => void;
  /** The runs of the panel: the registry of providers is read again when they change. */
  runs: RunView[];
  /** Opens a group of a run (from the topology of a pipeline). */
  onOpenGroup: (target: { runId: string; slug: string }, step: string | null) => void;
  /** The open tab of the group «Agents» (`general` or `mcp`) or «Integrations»; null for the first. */
  agentTab: string | null;
  /** The kind whose page of the catalog «Integrations» is open; null for the catalog itself. */
  integrationKind: string | null;
  /** The open tab of the group «Observers»; null for the first. */
  observerTab: string | null;
  onSelectObserverTab: (tab: ObserverTab) => void;
  /** The last `observers` event of the stream; null until one arrives. */
  streamedObservers: ObserversView | null;
  /** The last `network` event of the stream; null until one arrives. */
  streamedNetwork: NetworkStatus | null;
  /** The open project of the group «Projects» (a slug or `new`); null for none. */
  project: string | null;
  onSelectProject: (slug: string | null) => void;
  /** The open runtime of the group «Runtimes» (its key); null for the overview. */
  runtime: string | null;
  onSelectRuntime: (key: string | null) => void;
  /** Every project of the daemon, disabled ones too. */
  registry: RepositoryView[];
  onRegistry: (registry: RepositoryView[]) => void;
  /** A project moved: the chosen repository of the panel follows it. */
  onProjectMoved: (from: string, to: string) => void;
  /** Asks and removes a project from the list; true when it is gone. */
  onRemoveProject: (path: string) => Promise<boolean>;
  /** Makes a project the panel's repository and opens its settings or its queue. */
  onOpenProject: (path: string, target: 'settings' | 'queue') => void;
  /** The selected repository; null while none is known. */
  repository: string | null;
  /** The repositories of the panel, the choices of «Project». */
  repositories: string[];
  onSelectRepository: (path: string) => void;
  queue: QueueView | null;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
  /** Whether a form has unsaved changes; leaving then asks first. */
  dirty: RefObject<boolean>;
}
