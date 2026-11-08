import type { Runtime, RuntimeExtra } from '../types/index.ts';

/** Builds the adapter of one agent CLI from its executable and the extras of the settings. */
export type RuntimeFactory = (executable: string, extra: RuntimeExtra) => Runtime;

/** The adapters of the agent CLIs; `app` takes them from `clients/`. */
export interface RuntimeFactories {
  claude: RuntimeFactory;
  opencode: RuntimeFactory;
  agy: RuntimeFactory;
}
