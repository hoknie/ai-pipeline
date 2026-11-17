import type { RefObject } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, RepositoryView, RunView } from '../../../shared/api/types.ts';
import type { SwarmScope, SwarmTarget } from './tabs.ts';

/** The mode «All projects» of the lists of the project area. */
export interface SwarmProjects {
  registry: RepositoryView[];
  last: string | null;
}

/** What a host (the top bar or the settings) gives the window. */
export interface SwarmWorkspaceProps {
  /** The API of the selected project. */
  api: Api;
  scope: SwarmScope;
  /** The place that is open. */
  place: SwarmTarget;
  repository: string | null;
  runs: RunView[];
  /** Whether a form has unsaved changes; changing the tab then asks first. */
  dirty: RefObject<boolean>;
  /** The mode «All projects» (the top bar only). */
  projects?: SwarmProjects | undefined;
  /** The configuration of the shared files and its reload (the shared scope). */
  config?: ConfigEditorResponse | null | undefined;
  onReload?: (() => Promise<void>) | undefined;
  /** The address of a place, for the links of the tabs. */
  hrefOf: (target: SwarmTarget) => string;
  onNavigate: (target: SwarmTarget) => void;
  /** Opens a group of a run (from the topology of a pipeline). */
  onOpenGroup: (target: { runId: string; slug: string }, step: string | null) => void;
}
