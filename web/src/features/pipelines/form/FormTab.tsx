import { useTranslation } from 'react-i18next';

import type {
  ConfigEditorResponse,
  EditorPipeline,
  FieldError,
} from '../../../shared/api/types.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import { rawName } from '../../../shared/lib/pipeline/pipelineName.ts';
import { specialistOptions, type SpecialistOption } from '../../../shared/lib/specialistLabels.ts';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { stepIds } from '../stepIds.ts';
import { PipelineTagsInput } from './PipelineTagsInput.tsx';
import { PointsInput } from './points/PointsInput.tsx';
import { record } from './steps/draft.ts';
import { withPoint, withSplit } from './steps/draftOps.ts';
import { SplitFieldset } from './steps/SplitFieldset.tsx';
import { StepsList } from './steps/StepsList.tsx';
import type { usePipelineEditor } from './usePipelineEditor.ts';

export interface Places {
  split: FieldError[];
  tags: FieldError[];
  name: FieldError[];
  other: FieldError[];
}

/** The specialists a step can name. */
export function specialistChoices(
  view: ConfigEditorResponse,
  sharedOnly: boolean,
): SpecialistOption[] {
  return specialistOptions(
    view.specialists.filter((specialist) => !sharedOnly || specialist.sources.global),
  );
}

/** The pipelines the groups of a split can follow, and how to name them. */
export function splitTargets(
  view: ConfigEditorResponse,
  id: string,
  sharedOnly: boolean,
  own: string,
) {
  const targets = view.pipelines
    .filter((candidate) => !sharedOnly || candidate.sources.global)
    .filter((candidate) => candidate.id !== id && !record(record(candidate.raw).split).pipeline)
    .map((candidate) => candidate.id);
  if (own !== '' && !targets.includes(own)) targets.push(own);
  const nameOf = (target: string): string =>
    rawName(record(view.pipelines.find((candidate) => candidate.id === target)?.raw)) ?? target;
  return { targets, nameOf };
}

type Editor = ReturnType<typeof usePipelineEditor>;

function NameField({
  editor,
  errors,
  disabled,
}: {
  editor: Editor;
  errors: FieldError[];
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="field-pipeline-name">{t('pipelines.name')}</Label>
      <Input
        id="field-pipeline-name"
        type="text"
        value={editor.draft.name}
        disabled={disabled}
        onChange={(event) =>
          editor.setDraft((current) => ({ ...current, name: event.target.value }))
        }
      />
      {errors.map((error) => (
        <p className="text-sm text-destructive" role="alert" key={`${error.path}:${error.message}`}>
          {error.message}
        </p>
      ))}
    </div>
  );
}

/** The steps, or the note that the groups follow the steps of another pipeline. */
function StepsOrFollow({
  editor,
  nameOf,
  options,
  disabled,
}: {
  editor: Editor;
  nameOf: (pipeline: string) => string;
  options: SpecialistOption[];
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { draft } = editor;
  if (draft.split?.pipeline) {
    return (
      <p className="text-sm">
        {t('pipelines.groupsFollow')}{' '}
        <a
          className="underline"
          href={formatRoute({
            view: 'pipelines',
            run: draft.split.pipeline,
            group: null,
            step: null,
            tab: null,
          })}
        >
          {nameOf(draft.split.pipeline)}
        </a>
      </p>
    );
  }
  return (
    <StepsList
      draft={draft}
      ids={stepIds(draft.steps)}
      pipelineId={editor.id}
      options={options}
      disabled={disabled}
      errors={editor.errors}
      onDraft={editor.setDraft}
    />
  );
}

/** The fields of the form: name, tags, id, split, steps and the action points. */
export function FormTab({
  editor,
  view,
  pipeline,
  sharedOnly,
  places,
  disabled,
}: {
  editor: Editor;
  view: ConfigEditorResponse;
  pipeline: EditorPipeline | null;
  sharedOnly: boolean;
  places: Places;
  disabled: boolean;
}) {
  const { draft, setDraft, preview } = editor;
  const options = specialistChoices(view, sharedOnly);
  const { targets, nameOf } = splitTargets(
    view,
    editor.id,
    sharedOnly,
    draft.split?.pipeline ?? '',
  );
  return (
    <>
      <NameField editor={editor} errors={places.name} disabled={disabled} />
      <PipelineTagsInput
        view={view}
        pipeline={pipeline}
        level={editor.level}
        tags={draft.tags}
        disabled={disabled}
        errors={places.tags}
        onTags={(tags) => setDraft((current) => ({ ...current, tags }))}
      />
      {!pipeline ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="field-pipeline-id">Id</Label>
          <Input
            id="field-pipeline-id"
            type="text"
            value={editor.newId}
            disabled={editor.busy}
            placeholder="feature"
            onChange={(event) => editor.setNewId(event.target.value)}
          />
        </div>
      ) : null}
      <SplitFieldset
        split={draft.split}
        options={options}
        targets={targets}
        nameOf={nameOf}
        disabled={disabled}
        errors={places.split}
        onSplit={(patch) => setDraft((current) => withSplit(current, patch))}
      />
      <StepsOrFollow editor={editor} nameOf={nameOf} options={options} disabled={disabled} />
      <PointsInput
        view={view}
        hasSplit={draft.split !== null}
        stages={draft.stages}
        previewStages={
          preview.topology === null
            ? null
            : (preview.topology as { stages?: { id: string; kind: string }[] }).stages
        }
        sharedOnly={sharedOnly}
        disabled={disabled}
        onPoint={(point, list) => setDraft((current) => withPoint(current, point, list))}
      />
    </>
  );
}
