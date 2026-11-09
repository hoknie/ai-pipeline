import type { RefObject } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ObserversView } from '../../../shared/api/observerTypes.ts';
import type { QueueView, RepositoryView } from '../../../shared/api/types.ts';
import type {
  ObserverTab,
  SettingsGroup,
  SettingsScope,
} from '../../../shared/lib/nav/settingsGroups.ts';

export interface SettingsPageProps {
  api: Api;
  scope: SettingsScope;
  group: SettingsGroup;
  /** The open shared specialist of the group «Specialists» (a slug or `new`); null for none. */
  specialist: string | null;
  onSelectSpecialist: (slug: string | null) => void;
  /** The open shared pipeline of the group «Pipeline» (an id or `new`); null for none. */
  pipeline: string | null;
  onSelectPipeline: (id: string | null) => void;
  /** The open shared chain of the group «Chains» (a slug or `new`); null for none. */
  chain?: string | null;
  onSelectChain?: (slug: string | null) => void;
  /** The open tab of the group «Observers»; null for the first. */
  observerTab: string | null;
  onSelectObserverTab: (tab: ObserverTab) => void;
  /** The last `observers` event of the stream; null until one arrives. */
  streamedObservers: ObserversView | null;
  /** The open project of the group «Projects» (a slug or `new`); null for none. */
  project: string | null;
  onSelectProject: (slug: string | null) => void;
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
