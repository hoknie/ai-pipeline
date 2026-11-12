import { useTranslation } from 'react-i18next';

import type {
  SystemKind,
  SystemStageEntry,
  SystemStagesResponse,
} from '../../shared/lib/pipeline/pipelineEntries.ts';
import { formatRoute } from '../../shared/lib/nav/route.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Label } from '../../shared/ui/forms/label.tsx';
import { Textarea } from '../../shared/ui/forms/textarea.tsx';
import type { WriteLevel } from '../../shared/api/types.ts';

import { Button } from '../../shared/ui/forms/button.tsx';
import { STAGE_SECTIONS, fieldKey } from '../../shared/ui/forms/settings/settingFields.ts';

/** The level a stage is shown at: the project when it sets any of its settings, else the shared. */
export function stageLevel(stage: SystemStageEntry | undefined): WriteLevel {
  return stage?.settings.some((setting) => setting.level === 'project') ? 'project' : 'global';
}

function StageTask({
  stage,
  performer,
}: {
  stage: SystemStageEntry | undefined;
  performer: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="system-task">{t('pipeline.system.task')}</Label>
      {stage?.task ? (
        <Textarea
          id="system-task"
          readOnly
          rows={12}
          className="font-mono text-xs"
          value={stage.task}
          aria-label={t('pipeline.system.taskLabel', { name: performer })}
        />
      ) : (
        <p id="system-task" className="text-sm text-muted-foreground">
          {t('pipeline.system.noTask')}
        </p>
      )}
      {stage?.task ? (
        <p className="text-xs text-muted-foreground">{t('pipeline.system.taskHelp')}</p>
      ) : null}
    </div>
  );
}

const SOURCE_KEY = {
  project: 'settingsPage.source.project',
  global: 'pipeline.system.sourceGlobal',
  default: 'settingsPage.source.default',
} as const;

function StageValue({ stage, path }: { stage: SystemStageEntry | undefined; path: string }) {
  const { t } = useTranslation();
  const setting = stage?.settings.find((candidate) => candidate.path === path);
  const value = setting?.value;
  const key = fieldKey(path);
  let shown: string;
  if (value === undefined || value === null || value === '') shown = t('settingsPage.notSet');
  else if (typeof value === 'boolean')
    shown = t(value ? 'pipeline.system.yes' : 'pipeline.system.no');
  else if (path === 'delivery.mode') shown = t(`deliveryMode.${String(value)}` as never);
  else shown = String(value);
  return (
    <div className="flex flex-col gap-0.5" data-testid={`stage-value-${path}`}>
      <span className="text-sm font-medium">{t(`settingsPage.field.${key}.label` as never)}</span>
      <span data-testid="stage-shown" className="whitespace-pre-wrap break-words text-sm">
        {shown}
      </span>
      <span className="text-xs text-muted-foreground">
        <span data-testid="stage-source">{t(SOURCE_KEY[setting?.level ?? 'default'])}</span>{' '}
        <code className="text-xs">{path}</code>
      </span>
    </div>
  );
}

function StageSettings({
  kind,
  stage,
}: {
  kind: Exclude<SystemKind, 'split'>;
  stage: SystemStageEntry | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{t('pipeline.system.settings')}</h3>
      {STAGE_SECTIONS[kind]
        .flatMap((section) => section.paths)
        .map((path) => (
          <StageValue key={path} stage={stage} path={path} />
        ))}
      <p className="text-xs text-muted-foreground">{t('pipeline.system.settingsHelp')}</p>
      <div>
        <Button variant="outline" asChild>
          <a
            href={formatRoute({
              view: 'settings',
              run: 'delivery',
              group: stageLevel(stage),
              step: null,
              tab: null,
            })}
          >
            {t('pipelines.editInSettings')}
          </a>
        </Button>
      </div>
    </div>
  );
}

export function SystemStagePage({
  kind,
  stages,
  failure,
}: {
  kind: SystemKind;
  /** null while the stages are not loaded or could not be. */
  stages: SystemStagesResponse | null;
  failure: string | null;
}) {
  const { t } = useTranslation();
  const stage = stages?.stages.find((candidate) => candidate.kind === kind);
  const performer = stage?.name ?? t(`pipeline.system.kinds.${kind}`);

  return (
    <section className="flex flex-col gap-3" aria-label={t('pipeline.system.section', { kind })}>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t(`pipeline.system.kinds.${kind}`)}</h2>
        <p className="text-sm text-muted-foreground">{t(`pipeline.system.hints.${kind}`)}</p>
      </div>
      {failure ? (
        <Alert variant="destructive">{t('pipeline.system.loadFailed', { message: failure })}</Alert>
      ) : null}
      {stages && stages.errors.length > 0 ? (
        <Alert variant="destructive">
          <ul>
            {stages.errors.map((error) => (
              <li key={`${error.file ?? ''}:${error.path}:${error.message}`}>
                <code>{error.path}</code>: {error.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <StageTask stage={stage} performer={performer} />

      {kind !== 'split' ? (
        <StageSettings kind={kind} stage={stage} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('pipeline.system.splitSettings')}</p>
      )}
    </section>
  );
}
