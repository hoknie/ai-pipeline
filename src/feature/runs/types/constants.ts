import { type Runtime, OBSERVER_SPECIALIST } from '../../swarm-config/types/index.ts';

export const SPLIT_GROUP = '_split';

export const SPLIT_STEP = 'split';

export const MESSAGE_GROUP = '_message';

export const MESSAGE_STEP = 'message';

export const RESOLVE_GROUP = '_resolve';

export const RESOLVE_STEP = 'resolve';

export const REPAIR_GROUP = '_repair';

export const REPAIR_STEP = 'repair';

/** Slug of the specialist of the observer; the profile itself lives in `Run.repair.specialist`. */
export const REPAIR_SPECIALIST = OBSERVER_SPECIALIST;

/** Prefix of the slugs of pipeline action groups: `_action-<point>-<id>`. */
export const ACTION_GROUP_PREFIX = '_action-';

export const ACTION_STEP = 'action';

/** Runtime of the attempt of a command action: the daemon runs a shell command, not an agent. */
export const COMMAND_RUNTIME = 'command';

export type AttemptRuntime = Runtime | typeof COMMAND_RUNTIME;

export const SUMMARY_LIMIT = 4000;

export const FEEDBACK_LIMIT = 16000;

export const GROUP_STATUSES = [
  'queued',
  'running',
  'needs_human',
  'merging',
  'merged',
  'conflict',
  'failed',
  'cancelled',
] as const;

export type GroupStatus = (typeof GROUP_STATUSES)[number];

export function isTerminal(status: GroupStatus): boolean {
  return status === 'merged' || status === 'failed' || status === 'cancelled';
}

export type AttemptStatus = 'running' | 'finished' | 'failed' | 'cancelled';

export const QUESTIONS_LIMIT = 10;

export const QUESTION_TEXT_LIMIT = 2000;

export const OPTIONS_LIMIT = 6;

export const OPTION_LIMIT = 200;

export const RECOMMENDATION_LIMIT = 2000;

/** What a usage limit does to a group: wait for the reset or fail. */
export const ON_LIMIT_MODES = ['wait', 'stop'] as const;

export type OnLimit = (typeof ON_LIMIT_MODES)[number];

/** How long a usage limit holds when the runtime did not say when it resets. */
export const USAGE_LIMIT_FALLBACK_MS = 15 * 60 * 1000;

/** Why the scheduler does not start new steps of a run. */
export const RUN_HOLDS = ['paused', 'frozen'] as const;

export type RunHold = (typeof RUN_HOLDS)[number];

export const INCIDENT_KINDS = ['question', 'failed', 'conflict', 'delivery'] as const;

export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const DELIVERY_STATES = ['pending', 'applied', 'apply_failed'] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

export type RefStyle = 'branches' | 'refs';
