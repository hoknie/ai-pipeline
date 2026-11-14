import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type {
  ConfigEditorResponse,
  EditorPipeline,
  FieldError,
  WriteLevel,
} from '../../../shared/api/types.ts';
import { specialistNames } from '../../../shared/lib/catalog/specialists.ts';
import { rawName } from '../../../shared/lib/pipeline/pipelineName.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../../shared/ui/forms/toggle-group.tsx';
import { FormTab, type Places } from './FormTab.tsx';
import { SchemaTab } from './SchemaTab.tsx';
import { FilePath } from '../../../shared/ui/layout/FilePath.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../shared/ui/layout/tabs.tsx';
import { PREVIEW_DELAY_MS } from './editorState.ts';
import { PipelineButtons } from './PipelineButtons.tsx';
import { LevelHint, PipelineNotices } from './PipelineNotices.tsx';
import { UsageBlock, type SharedPipelineOnly } from './PipelineUsage.tsx';
import { hasDuplicateIds } from './variants/variantDraft.ts';
import { draftOf, isNameError, isTagsError, stepOfError, valueOf } from './steps/draft.ts';
import { SpecialistNames } from './steps/SpecialistNames.ts';
import { usePipelineEditor } from './usePipelineEditor.ts';

export { PREVIEW_DELAY_MS, draftOf, valueOf };
export type { SharedPipelineOnly };

interface PipelineFormProps {
  api: Api;
  view: ConfigEditorResponse;
  /** null for a new pipeline. */
  pipeline: EditorPipeline | null;
  activeRuns: number;
  notice: string | null;
  onDirty: (dirty: boolean) => void;
  onReload: () => Promise<void>;
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
  /** Edits a shared pipeline at the shared level only, with the usage by the projects. */
  sharedOnly?: SharedPipelineOnly;
}

/** The errors of the preview or of a write, by the part of the form they belong to. */
function errorsByPlace(
  errors: FieldError[],
  id: string,
  hasSplit: boolean,
  variantId: string | null,
) {
  const inVariant = (error: FieldError) =>
    variantId !== null &&
    (error.path === `swarm.pipelines.${id}.variants.${variantId}` ||
      error.path.startsWith(`swarm.pipelines.${id}.variants.${variantId}.`));
  const place = (error: FieldError) => stepOfError(error.path, id, hasSplit);
  return {
    split: errors.filter((error) => place(error).split),
    tags: errors.filter((error) => isTagsError(error.path, id)),
    name: errors.filter((error) => isNameError(error.path, id)),
    other: errors.filter((error) => {
      const at = place(error);
      return (
        at.step === null &&
        !at.split &&
        !isNameError(error.path, id) &&
        !isTagsError(error.path, id) &&
        !inVariant(error)
      );
    }),
  };
}

export function LevelToggle({
  level,
  onChange,
}: {
  level: WriteLevel;
  onChange: (level: WriteLevel) => void;
}) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      type="single"
      value={level}
      aria-label={t('settings.editor.level')}
      onValueChange={(value) => value && onChange(value as WriteLevel)}
    >
      <ToggleGroupItem value="project">{t('settings.editor.project')}</ToggleGroupItem>
      <ToggleGroupItem value="global">{t('settings.editor.global')}</ToggleGroupItem>
    </ToggleGroup>
  );
}

function FormHeading({
  pipeline,
  file,
}: {
  pipeline: EditorPipeline | null;
  file: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold">
        {pipeline ? (rawName(pipeline.raw) ?? pipeline.id) : t('pipelines.new')}
      </h2>
      {pipeline ? <FilePath variant="line" path={file ?? pipeline.file} /> : null}
    </div>
  );
}

function EditorTabs({
  editor,
  view,
  pipeline,
  sharedOnly,
  places,
  disabled,
}: {
  editor: ReturnType<typeof usePipelineEditor>;
  view: ConfigEditorResponse;
  pipeline: EditorPipeline | null;
  sharedOnly: boolean;
  places: Places;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { preview } = editor;
  return (
    <Tabs value={editor.tab} onValueChange={editor.setTab}>
      <TabsList aria-label={t('pipelines.tabs')}>
        <TabsTrigger value="form">{t('pipelines.form')}</TabsTrigger>
        <TabsTrigger value="schema">
          {t('pipelines.schema')}{' '}
          {preview.stale ? <Badge variant="warn">{t('pipelines.stale')}</Badge> : null}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="form" className="flex min-w-0 flex-col gap-3">
        <FormTab
          editor={editor}
          view={view}
          pipeline={pipeline}
          sharedOnly={sharedOnly}
          places={places}
          disabled={disabled}
        />
      </TabsContent>
      <TabsContent value="schema">
        <SchemaTab editor={editor} view={view} sharedOnly={sharedOnly} disabled={disabled} />
      </TabsContent>
    </Tabs>
  );
}

export function PipelineForm(props: PipelineFormProps) {
  const { view, pipeline, notice, sharedOnly } = props;
  const { t } = useTranslation();
  const editor = usePipelineEditor(props);
  const { level, draft, id, busy, readOnly, source, sources } = editor;
  const disabled = readOnly || busy;
  const shown = draft.variants.find((variant) => variant.key === editor.variant) ?? null;
  const places = errorsByPlace(editor.errors, id, draft.split !== null, shown?.id ?? null);
  const copyOnly = pipeline !== null && !sharedOnly;
  const names = useMemo(() => specialistNames(view.specialists), [view.specialists]);
  return (
    <SpecialistNames.Provider value={names}>
      <section
        className="flex flex-col gap-3"
        aria-label={t('pipelines.section', { id: id || t('pipelines.newName') })}
      >
        <FormHeading pipeline={pipeline} file={source?.file} />
        {readOnly ? <Alert role="status">{t('pipelines.sharedReadOnly')}</Alert> : null}
        <PipelineNotices
          view={view}
          notice={notice}
          problem={editor.problem}
          conflict={editor.conflict}
          otherErrors={places.other}
          references={editor.references}
          onReread={() => void editor.reread()}
        />
        {sharedOnly ? (
          <p className="text-sm text-muted-foreground">{t('pipelines.sharedOnlyHint')}</p>
        ) : null}
        {sharedOnly && pipeline ? <UsageBlock shared={sharedOnly} view={view} /> : null}
        {copyOnly && editor.bothLevels ? (
          <LevelToggle level={level} onChange={(next) => void editor.switchLevel(next)} />
        ) : null}
        <LevelHint
          global={level === 'global'}
          sharedOnly={Boolean(sharedOnly)}
          projectFile={Boolean(sources.project)}
          globalFile={sources.global?.file ?? null}
        />
        <EditorTabs
          editor={editor}
          view={view}
          pipeline={pipeline}
          sharedOnly={Boolean(sharedOnly)}
          places={places}
          disabled={disabled}
        />
        <PipelineButtons
          pipeline={pipeline}
          readOnly={readOnly}
          busy={busy}
          canSave={(Boolean(pipeline) || editor.newId !== '') && !hasDuplicateIds(draft.variants)}
          overrideInProject={copyOnly && Boolean(sources.global) && !sources.project}
          makeGlobal={pipeline !== null && Boolean(sources.project) && !sources.global && !readOnly}
          canRemove={Boolean(pipeline && source) && !readOnly}
          removeBlocked={editor.removeBlocked}
          removeBlockedReason={editor.removeBlockedReason}
          removeLabel={editor.removeLabel}
          saveAs={editor.saveAs}
          onSave={() => void editor.save()}
          onCopyTo={(target) => void editor.copyTo(target)}
          onSaveAs={editor.setSaveAs}
          onSaveCopy={() => void editor.saveCopy()}
          onRemove={() => void editor.remove()}
        />
      </section>
    </SpecialistNames.Provider>
  );
}
