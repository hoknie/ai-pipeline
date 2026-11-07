import type { Api } from '../../../../shared/api/api.ts';
import type { GroupRow, RunView, SystemStepRow } from '../../../../shared/api/types.ts';

export type GroupScreenProps = {
  /** Tab asked for by the address; null for the log. */
  tab?: string | null;
  onTab?: (tab: string) => void;
  /** Opens a group or a system step of the run (the resolver badge). */
  onSelectEntry?: (slug: string) => void;
  /** The run header is scrolled out of view: show the run title, statuses, duration, tokens and cost in the header. */
  showUsage?: boolean;
  api: Api;
  runId: string;
  row: GroupRow | SystemStepRow;
  /** Open the last attempt of this step instead of the last attempt of the group. */
  openStep?: string | null;
  /** Prefix of the keys of the drafts of this group: `<run>/<group>`. */
  draftKey: string;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onClearDrafts: (prefix: string) => void;
  onError: (message: string) => void;
  /** Show only the texts of the specialist in every log. */
  onlyReplies?: boolean;
  onOnlyReplies?: (value: boolean) => void;
  /** Whether delivery of the merged groups can be started now (for a failed delivery step). */
  deliverable?: boolean;
  onDeliver?: () => Promise<unknown>;
  /** The run of the group, for the `--force` delivery dialog. */
  run?: RunView;
  onForceDeliver?: () => Promise<unknown>;
};
