import type { TFunction } from 'i18next';

import type { StagePerformer } from './pipelineStages.ts';

/** Who performs a stage: the specialist, the command or the system. */
export function performerText(performer: StagePerformer, t: TFunction): string {
  switch (performer.type) {
    case 'specialist':
      return performer.name || performer.slug;
    case 'command':
      return performer.command;
    default:
      return t('topology.stages.system');
  }
}

const CONDITIONS = new Set(['delivery_commit', 'conflict', 'not_keep']);

/** The text of the condition under which a stage runs; `null` for a stage that always runs. */
export function conditionText(key: string | null, t: TFunction): string | null {
  if (key === null) return null;
  return CONDITIONS.has(key) ? t(`topology.stages.condition.${key as 'conflict'}`) : key;
}
