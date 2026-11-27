import type { ChainMode, ReasoningEffort } from '../../../shared/api/types.ts';

export type SpecialistRuntimeName =
  'claude' | 'opencode' | 'agy' | 'codex' | 'kilo' | 'cline' | 'copilot';

export interface ChainRuntimeDraft {
  runtime: SpecialistRuntimeName;
  /** Keep an invalid or absent source route until the user explicitly selects one. */
  invalidRuntime?: { value: unknown } | undefined;
  model: string;
  /** Keep even an empty/null model that conflicts with a source role. */
  conflictingModel?: { value: unknown } | undefined;
  model_role: string;
  /** Preserve malformed source until an explicit model choice repairs it. */
  invalidModelRole?: { value: unknown } | undefined;
  /** Editor-only reminder, attached to the item rather than its row position. */
  chooseRole?: boolean;
  variant: string;
  reasoning_effort: ReasoningEffort | '';
  /** Preserve source option types/values until that field or the runtime is edited. */
  sourceOptions?: Record<string, unknown> | undefined;
  enabled: boolean;
  provider: string;
  default: boolean;
}

export interface ChainDraft {
  slug: string;
  name: string;
  mode: ChainMode;
  enabled: boolean;
  runtimes: ChainRuntimeDraft[];
}
