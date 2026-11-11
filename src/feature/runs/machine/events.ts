import type {
  Denial,
  PermissionsRefresh,
  SpecialistsRefresh,
  Usage,
} from '../../agents/types/index.ts';
import type { Specialist } from '../../swarm-config/types/index.ts';
import type {
  FailReason,
  Incident,
  OnLimit,
  ProposedGroup,
  Report,
  RunHold,
  RunState,
} from '../types/index.ts';

export type Effect =
  | { kind: 'start_attempt'; run: string; group: string; seq: number }
  | { kind: 'stop_attempt'; run: string; group: string; seq: number }
  | { kind: 'commit'; run: string; group: string; stepId: string; summary: string }
  | { kind: 'merge'; run: string; group: string; updateOnConflict: boolean }
  /** The daemon runs the shell command of a pipeline action. */
  | { kind: 'run_action'; run: string; group: string; seq: number }
  | DeliveryEffect;

/** How a command action ended. */
export type ActionOutcome =
  { kind: 'exit'; code: number } | { kind: 'timeout' } | { kind: 'spawn'; message: string };

export type MergeOutcome =
  | { kind: 'merged'; commit: string | null }
  | { kind: 'conflict'; files: string[] }
  | { kind: 'conflict_updated'; files: string[] }
  | { kind: 'failed'; message: string };

export interface AttemptExit {
  sessionId: string | null;
  usage: Usage | null;
  failure: FailReason | null;
  outsideChanges: string[];
  /** Tool calls the agent CLI refused; absent when the runtime does not report them. */
  denials?: Denial[];
  /** What a usage limit does to the group: `wait` (default) keeps it queued, `stop` fails it. */
  onLimit?: OnLimit;
}

export type DeliveryEffect =
  | {
      kind: 'deliver';
      run: string;
      groups: string[];
      force: boolean;
      message: string;
      auto: boolean;
    }
  | { kind: 'cleanup'; run: string }
  | { kind: 'prepare_resolve'; run: string; groups: string[]; round: number }
  | { kind: 'finish_resolve'; run: string; groups: string[]; message: string; conflicts: string[] };

export interface DeliveryRequest {
  groups: string[] | null;
  force: boolean;
  files: string[];
  auto: boolean;
}

export type DeliveryResult =
  | {
      kind: 'applied';
      files: string[];
      conflicts: string[];
      commit: string | null;
      userEdits?: string[];
    }
  | { kind: 'refused'; reason: string; files: string[]; conflict?: boolean }
  | { kind: 'failed'; message: string };

export type Event =
  | { kind: 'report'; group: string; seq: number; report: Report }
  | { kind: 'split_proposed'; seq: number; groups: ProposedGroup[] }
  | { kind: 'attempt_exited'; group: string; seq: number; exit: AttemptExit }
  | { kind: 'attempt_usage'; updates: { group: string; seq: number; usage: Usage }[] }
  | { kind: 'timed_out'; group: string; seq: number }
  | { kind: 'action_finished'; group: string; seq: number; outcome: ActionOutcome }
  | { kind: 'message'; group: string; seq: number; text: string }
  /** `reason`: why an observer cancels; it is written to the cancelled groups. */
  | { kind: 'cancel'; group: string | null; reason?: string }
  | {
      kind: 'retry';
      group: string;
      permissions?: PermissionsRefresh;
      /** The whole specialists of the current configuration; replaces `permissions` when set. */
      specialists?: SpecialistsRefresh;
      /** The run is held in the same transition, so no agent starts (a retry with no free place). */
      hold?: 'frozen';
    }
  | {
      kind: 'answer';
      group: string;
      answer: string;
      by?: 'human' | 'autopilot' | 'observer';
      permissions?: PermissionsRefresh;
    }
  | { kind: 'merge_finished'; group: string; outcome: MergeOutcome }
  | { kind: 'commit_failed'; group: string; message: string }
  | { kind: 'deliver_requested'; groups: string[] | null; force: boolean; files: string[] }
  | { kind: 'delivered_marked'; groups: string[] | null }
  | { kind: 'delivery_finished'; result: DeliveryResult }
  | { kind: 'resolve_prepared'; conflicts: string[] }
  | { kind: 'run_named'; title: string | null; name: string | null; usage: Usage | null }
  | { kind: 'tags_set'; tags: string[] }
  | { kind: 'title_set'; title: string }
  | { kind: 'step_skip'; step: string; skip: boolean }
  | { kind: 'hold'; hold: RunHold | null }
  /** An observer takes the incident; `specialist` is its profile at this moment. */
  | { kind: 'repair_start'; incident: Incident; specialist: Specialist }
  /** The user lets observers take the task (true) or forbids it (false). */
  | { kind: 'repair_allowed'; allowed: boolean }
  | { kind: 'interrupted' };

/** What a transition works on: the run, the clock, the collected effects and two flags. */
export interface Ctx {
  readonly state: RunState;
  readonly now: number;
  readonly effects: Effect[];
  /** The whole run was cancelled while its delivery waited for the checks: no automatic delivery follows. */
  checksCancelled: boolean;
  /** A pause ended the repair that went on. */
  pausedRepair: boolean;
}
