import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import {
  PROMPT_PATHS,
  type SystemKind,
  type SystemStageEntry,
  type SystemStagesResponse,
} from '../pipelineEntries.ts';
import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Label } from '../ui/label.tsx';
import { Textarea } from '../ui/textarea.tsx';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.tsx';
import type { ConfigEditorResponse, WriteLevel } from '../types.ts';

import { DeliveryFields } from './settings/DeliveryFields.tsx';

/** The level a stage is shown at: the project when it sets any of its settings, else the shared. */
export function stageLevel(stage: SystemStageEntry | undefined): WriteLevel {
  return stage?.settings.some((setting) => setting.level === 'project') ? 'project' : 'global';
}

/** Settings of the delivery stage that `DeliveryFields` edits. */
const EDITED_ELSEWHERE = new Set(['delivery.mode', 'delivery.auto']);

const show = (value: unknown): string =>
  typeof value === 'string' ? value : value === null ? '—' : JSON.stringify(value);

export function SystemStagePage({
  api,
  kind,
  view,
  stages,
  failure,
  onDirty,
  onReload,
}: {
  api: Api;
  kind: SystemKind;
  view: ConfigEditorResponse;
  /** null while the stages are not loaded or could not be. */
  stages: SystemStagesResponse | null;
  failure: string | null;
  onDirty: (dirty: boolean) => void;
  onReload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const stage = stages?.stages.find((candidate) => candidate.kind === kind);
  const promptPath = PROMPT_PATHS[kind];
  const prompt = stage?.settings.find((setting) => setting.path === promptPath);
  const stored = typeof prompt?.value === 'string' ? prompt.value : '';
  // The level the user picked; until then the level the stage's settings come from.
  const [chosen, setChosen] = useState<WriteLevel | null>(null);
  const promptLevel = prompt?.level === 'default' ? undefined : prompt?.level;
  const level: WriteLevel = chosen ?? promptLevel ?? (promptPath ? 'project' : stageLevel(stage));
  const [value, setValue] = useState(stored);
  // Counts successful saves so the field returns to the reread value even when it did not change.
  const [saves, setSaves] = useState(0);
  useEffect(() => setValue(stored), [stored, saves]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const dirty = value !== stored;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const save = async () => {
    if (!promptPath) return;
    setBusy(true);
    setProblem(null);
    setSaved(null);
    try {
      const result = await api.writeSetting(
        promptPath,
        value.trim() === '' ? null : value,
        view.settingsFiles[level].revision,
        level,
      );
      if (result.ok) {
        setSaved(t('pipeline.system.saved', { file: result.file }));
        await onReload();
        setSaves((count) => count + 1);
      } else if (result.reason === 'conflict') {
        setProblem(t('settings.writeConflict', { message: result.message }));
      } else {
        setProblem(result.errors.map((error) => `${error.path}: ${error.message}`).join('; '));
      }
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const others = (stage?.settings ?? []).filter(
    (setting) =>
      setting.path !== promptPath && !(kind === 'delivery' && EDITED_ELSEWHERE.has(setting.path)),
  );
  const hasSettings = kind !== 'split';
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

      {hasSettings ? (
        <fieldset className="flex flex-col gap-3 rounded-lg border p-3" disabled={busy}>
          <legend className="px-1 text-sm font-medium">{t('pipeline.system.settings')}</legend>
          <ToggleGroup
            type="single"
            value={level}
            aria-label={t('settings.editor.level')}
            onValueChange={(next) => {
              if (next) setChosen(next as WriteLevel);
            }}
          >
            <ToggleGroupItem value="project">{t('settings.editor.project')}</ToggleGroupItem>
            <ToggleGroupItem value="global">{t('settings.editor.global')}</ToggleGroupItem>
          </ToggleGroup>
          {kind === 'delivery' ? (
            <DeliveryFields
              api={api}
              config={view}
              onReload={onReload}
              idPrefix="system-stage"
              writeLevel={level}
            />
          ) : null}
          {promptPath ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="system-prompt">{t('pipeline.system.prompt')}</Label>
              <Textarea
                id="system-prompt"
                rows={5}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t('pipeline.system.promptHelp', { path: promptPath })}
              </p>
              {problem ? <Alert variant="destructive">{problem}</Alert> : null}
              {saved ? <Alert role="status">{saved}</Alert> : null}
              <div>
                <Button disabled={busy || !dirty} onClick={() => void save()}>
                  {t('settings.editor.save')}
                </Button>
              </div>
            </div>
          ) : null}
          {others.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{t('pipeline.system.readOnly')}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                {others.map((setting) => (
                  <div key={setting.path} className="contents">
                    <dt>
                      <code>{setting.path}</code>
                    </dt>
                    <dd className="min-w-0 break-words">
                      {show(setting.value)}{' '}
                      <span className="text-xs text-muted-foreground">
                        ({t(`pipeline.system.source.${setting.level}`)})
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-muted-foreground">{t('pipeline.system.readOnlyHelp')}</p>
            </div>
          ) : null}
        </fieldset>
      ) : (
        <p className="text-sm text-muted-foreground">{t('pipeline.system.splitSettings')}</p>
      )}
    </section>
  );
}
