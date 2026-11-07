import { assembleLevel, readLevel, resolveLevels } from '../../swarm-config/services/index.ts';
import {
  ConfigLoadError,
  type ConfigPaths,
  type FieldError,
  type Level,
  type LevelFiles,
  type ResolvedConfig,
} from '../../swarm-config/types/index.ts';

export interface Resolution {
  config: ResolvedConfig | null;
  errors: FieldError[];
}

export function resolution(global: Level, project: Level): Resolution {
  try {
    return { config: resolveLevels(global, project).config, errors: [] };
  } catch (error) {
    if (error instanceof ConfigLoadError && error.detail.kind === 'invalid') {
      return { config: null, errors: error.detail.errors };
    }
    throw error;
  }
}

/** Both levels read with broken files reported as problems, so one bad file hides nothing. */
export function readLevels(paths: ConfigPaths): { global: LevelFiles; project: LevelFiles } {
  return {
    global: readLevel(paths.global, { tolerant: true }),
    project: readLevel(paths.project, { tolerant: true }),
  };
}

export function emptyLevel(): Level {
  return assembleLevel({ specialists: [], pipelines: [], actions: [], problems: [] });
}
