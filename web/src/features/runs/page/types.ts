import type { Api } from '../../../shared/api/api.ts';
import type { HistoryState, OpenedState } from '../../../shared/api/runs/runsState.ts';
import type { RunView } from '../../../shared/api/types.ts';
import type { Route } from '../../../shared/lib/nav/route.ts';
import type { RunFilterState, RunScope } from '../list/runFilter.ts';

export interface RunsPageProps {
  api: Api;
  runs: RunView[];
  loaded: boolean;
  /** Whether the run of the address is listed, being fetched by id, or unknown to the daemon. */
  openedState?: OpenedState;
  route: Route;
  now: number;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onClearDrafts: (prefix: string) => void;
  onError: (message: string) => void;
  onlyReplies: boolean;
  onOnlyReplies: (value: boolean) => void;
  onRoute: (route: Route) => void;
  /** The selected repository; null until known. */
  repository: string | null;
  /** The path of each repository as shown; absent: the path itself. */
  repositoryPaths?: ReadonlyMap<string, string>;
  scope: RunScope;
  /** Opens a new task as a child of the run; absent while the queue is unknown. */
  onSubtask?: (run: RunView) => void;
  /** Loading of older finished runs; without it the list is all there is. */
  history?: HistoryState;
  onScope: (scope: RunScope) => void;
}

/** What the parts of the page need to render the filters. */
export interface FilterProps {
  runs: RunView[];
  query: string;
  onQuery: (query: string) => void;
  filters: RunFilterState;
  onFilters: (filters: RunFilterState) => void;
  scope: RunScope;
  onScope: (scope: RunScope) => void;
  repository: string | null;
  repositoryPaths?: ReadonlyMap<string, string>;
}
