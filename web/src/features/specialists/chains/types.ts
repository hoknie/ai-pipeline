import type { ChainMode, ReasoningEffort } from '../../../shared/api/types.ts';

export type SpecialistRuntimeName =
  'claude' | 'opencode' | 'agy' | 'codex' | 'kilo' | 'cline' | 'copilot';

export interface ChainRuntimeDraft {
  runtime: SpecialistRuntimeName;
  model: string;
  variant: string;
  reasoning_effort: ReasoningEffort | '';
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
