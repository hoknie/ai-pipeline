import type { Runtime as RuntimeName } from '../../swarm-config/types/index.ts';
import type { Runtime, RuntimeExtra } from '../types/index.ts';

/** Builds the adapter of one agent CLI from its executable and the extras of the settings. */
export type RuntimeFactory = (executable: string, extra: RuntimeExtra) => Runtime;

/** The adapters of the agent CLIs, one per runtime name; `app` takes them from `clients/`. */
export type RuntimeFactories = Record<RuntimeName, RuntimeFactory>;
