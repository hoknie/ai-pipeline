import { useTranslation } from 'react-i18next';

import type { PipelineStage } from '../../../../shared/lib/pipeline/pipelineStages.ts';
import { conditionText, performerText } from '../../../../shared/lib/pipeline/stageText.ts';
import { stageFields } from '../steps/stageNodes.ts';
import type { StageNodeId } from './canvasModel.ts';

/** What a stage of the system does, who performs it and when; shown only. */
export function StageInspector({
  id,
  stages,
}: {
  id: StageNodeId;
  stages: readonly PipelineStage[] | null;
}) {
  const { t } = useTranslation();
  const { performer, link, condition: key } = stageFields(stages, id);
  const condition = conditionText(key, t);
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="canvas-stage-about">
      <p>{t(`topology.stages.about.${id}`)}</p>
      <p className="text-muted-foreground">
        {t('topology.stages.performer')}:{' '}
        {performer ? performerText(performer, t) : t('topology.stages.system')}
      </p>
      {condition !== null ? (
        <p className="text-muted-foreground">
          {t('topology.stages.conditionLabel')}: {condition}
        </p>
      ) : null}
      {link ? (
        <a className="text-primary underline-offset-4 hover:underline" href={link}>
          {t('topology.stages.open')}
        </a>
      ) : null}
    </div>
  );
}
