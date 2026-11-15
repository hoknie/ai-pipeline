import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import { cn } from '../../shared/lib/browser/cn.ts';
import { formatRoute } from '../../shared/lib/nav/route.ts';
import { Label } from '../../shared/ui/forms/label.tsx';

import type { Api } from '../../shared/api/api.ts';
import type { DeliveryMode } from '../../../../src/feature/swarm-config/types/index.ts';
import { useTags } from '../../shared/lib/catalog/tags.tsx';
import type { QueueFields, PipelinesView } from '../../shared/api/types.ts';
import { LinksEditor, type LinkKind, type LinkTargetGroup } from '../runs/index.ts';
import { continueDraft, draftValid, fieldsOf, type QueueDraft } from './draft.ts';
import { AttachmentFields } from './form/AttachmentFields.tsx';
import { focusNewTaskField } from './form/focusNewTaskField.ts';
import { DeliveryFields } from './form/DeliveryFields.tsx';
import { TagsField, withCurrent } from './form/LinkFields.tsx';
import { TaskFields, type FormState } from './form/TaskFields.tsx';

export {
  TITLE_LIMIT,
  continueDraft,
  draftOf,
  draftValid,
  emptyDraft,
  fieldsOf,
  retarget,
  type AttachmentEntry,
  type QueueDraft,
} from './draft.ts';

function FormButtons({
  disabled,
  hint,
  label,
  onContinue,
  onCancel,
}: {
  disabled: boolean;
  /** Why the task cannot be added yet. */
  hint?: string | undefined;
  label: string;
  onContinue: (() => void) | undefined;
  onCancel: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={disabled} title={hint}>
        {label}
      </Button>
      {onContinue ? (
        <Button type="button" variant="outline" disabled={disabled} onClick={onContinue}>
          {t('queue.addAndContinue')}
        </Button>
      ) : null}
      {onCancel ? (
        <Button variant="ghost" onClick={onCancel}>
          {t('queue.form.cancel')}
        </Button>
      ) : null}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/** Sends the draft; a failure is kept to show next to the form. */
function useSubmit(
  effective: QueueDraft,
  repository: string | null,
  idPrefix: string,
  onSubmit: (fields: QueueFields) => Promise<void>,
  onSubmitAndContinue: ((fields: QueueFields) => Promise<void>) | undefined,
  onDraft: (draft: QueueDraft) => void,
  returned: boolean,
) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const catalog = useTags();
  // after "add and continue" the cleared form takes the focus once it is drawn
  useEffect(() => {
    if (focusTick === 0) return;
    if (idPrefix === 'new') {
      focusNewTaskField(effective.mode);
      return;
    }
    const field = effective.mode === 'groups' ? 'group-0-title' : 'task';
    document.getElementById(`${idPrefix}-${field}`)?.focus();
    // only a new tick moves the focus
  }, [focusTick]);
  const send = async (keep: boolean) => {
    if (!draftValid(effective) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fields = fieldsOf(
        effective,
        (id) => {
          const tag = catalog.byId.get(id);
          return tag && tag.repository === repository && !tag.task ? tag.name : undefined;
        },
        idPrefix !== 'new',
        returned,
      );
      if (keep && onSubmitAndContinue) {
        await onSubmitAndContinue(fields);
        onDraft(continueDraft(effective));
        setFocusTick((tick) => tick + 1);
      } else {
        await onSubmit(fields);
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return {
    submit: () => send(false),
    submitAndContinue: onSubmitAndContinue ? () => send(true) : undefined,
    busy,
    error,
  };
}

/** The right half of the form: links, tags, attachments and delivery. */
function SideFields(props: {
  state: FormState;
  pipelines: PipelinesView | null;
  repository: string | null;
  api: Api | undefined;
  linkChoices: (kind: LinkKind) => LinkTargetGroup[];
  autoDeliverDefault: boolean | null;
  deliveryModeDefault: DeliveryMode | null;
  projectsPanel?: ReactNode;
  returnedRun?: string | null;
}) {
  const { state, pipelines, repository, api } = props;
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {state.several ? props.projectsPanel : null}
      <LinksEditor
        value={state.effective.links}
        choices={props.linkChoices}
        editableKinds={state.locked || state.several ? ['blocked_by'] : undefined}
        onChange={(links) => state.change({ links, linksTouched: true })}
      />
      {props.returnedRun && state.effective.links.some((link) => link.kind !== 'blocked_by') ? (
        <a
          className="text-sm text-primary underline"
          href={formatRoute({
            view: 'runs',
            run: props.returnedRun,
            group: null,
            step: null,
            tab: null,
          })}
        >
          {t('links.editRun')}
        </a>
      ) : null}
      {state.several ? null : (
        <>
          <TagsField state={state} repository={repository} api={api} />
          {api ? <AttachmentFields state={state} api={api} /> : null}
        </>
      )}
      <DeliveryFields
        state={state}
        pipelines={pipelines}
        autoDeliverDefault={props.autoDeliverDefault}
        deliveryModeDefault={props.deliveryModeDefault}
      />
    </div>
  );
}

interface QueueFormProps {
  idPrefix: string;
  draft: QueueDraft;
  pipelines: PipelinesView | null;
  /** The repository of the task; its tag catalog is the one the tag field offers. */
  repository: string | null;
  /** Lets the tag field create tags; without it the field only picks. */
  api?: Api;
  /** `delivery.auto` of the repository now; null when it is not known. */
  autoDeliverDefault?: boolean | null;
  /** `delivery.mode` of the repository now; null when it is not known. */
  deliveryModeDefault?: DeliveryMode | null;
  linkChoices?: (kind: LinkKind) => LinkTargetGroup[];
  /** A returned run keeps its own task: only the predecessors can change. */
  locked?: boolean;
  returnedRun?: string | null;
  /** The field of the repository, the first in the left half; only a new task has it. */
  repositoryField?: ReactNode;
  /** The task goes to several projects: no groups, attachments, project tags or parent. */
  several?: boolean;
  /** Fields of a task in several projects, under the text of the task. */
  extras?: ReactNode;
  /** The projects of a task in several projects, first in the right half. */
  projectsPanel?: ReactNode;
  /** Why the task cannot be added yet, shown next to the button. */
  blockedHint?: string;
  /** The data of the form is still loading: the form cannot be sent. */
  pending?: boolean;
  submitLabel: string;
  onDraft: (draft: QueueDraft) => void;
  /** Rejects with the message to show next to the form; the draft is kept then. */
  onSubmit: (fields: QueueFields) => Promise<void>;
  /** Adds the task and keeps the form: the button shows only with it; the form clears itself. */
  onSubmitAndContinue?: (fields: QueueFields) => Promise<void>;
  onCancel?: () => void;
  /** The form fills the height of its parent: the text of the task grows. */
  fill?: boolean;
}

function SubmitButtons({
  valid,
  blocked,
  blockedHint,
  sent,
  submitLabel,
  onCancel,
}: {
  valid: boolean;
  blocked: boolean;
  blockedHint: string | undefined;
  sent: ReturnType<typeof useSubmit>;
  submitLabel: string;
  onCancel: (() => void) | undefined;
}) {
  return (
    <FormButtons
      disabled={!valid || sent.busy || blocked}
      hint={blockedHint}
      label={submitLabel}
      onContinue={
        sent.submitAndContinue ? () => void (!blocked && sent.submitAndContinue?.()) : undefined
      }
      onCancel={onCancel}
    />
  );
}

export function QueueForm({
  idPrefix,
  draft,
  pipelines,
  repository,
  api,
  autoDeliverDefault = null,
  deliveryModeDefault = null,
  linkChoices = () => [],
  locked = false,
  returnedRun = null,
  repositoryField,
  several = false,
  extras,
  projectsPanel,
  blockedHint,
  pending = false,
  submitLabel,
  onDraft,
  onSubmit,
  onSubmitAndContinue,
  onCancel,
  fill = false,
}: QueueFormProps) {
  const { t } = useTranslation();
  const ids = pipelines?.pipelines.map((pipeline) => pipeline.id) ?? [];
  // a draft started before the pipelines were known takes the first one
  const effective: QueueDraft =
    draft.pipeline === '' && ids[0] ? { ...draft, pipeline: ids[0] } : draft;
  const change = (patch: Partial<QueueDraft>) => onDraft({ ...effective, ...patch });
  const valid = draftValid(effective);
  const state = { idPrefix, effective, change, locked, several };
  const sent = useSubmit(
    effective,
    repository,
    idPrefix,
    onSubmit,
    onSubmitAndContinue,
    onDraft,
    locked,
  );

  const options = withCurrent(ids, effective.pipeline);
  const blocked = pending || blockedHint !== undefined;
  return (
    <form
      className={cn(
        '@container flex flex-col gap-3 rounded-lg border bg-card p-3',
        fill && 'flex-1',
      )}
      onSubmit={(event) => {
        event.preventDefault();
        void (!blocked && sent.submit());
      }}
    >
      <div className={cn('grid gap-4 @3xl:grid-cols-2', fill && 'flex-1')}>
        <TaskFields
          state={state}
          pipelines={pipelines}
          options={options}
          repositoryField={repositoryField}
          extras={extras}
          fill={fill}
        />
        <SideFields
          state={state}
          pipelines={pipelines}
          repository={repository}
          api={api}
          linkChoices={linkChoices}
          returnedRun={returnedRun}
          autoDeliverDefault={autoDeliverDefault}
          deliveryModeDefault={deliveryModeDefault}
          projectsPanel={projectsPanel}
        />
      </div>
      <SubmitButtons {...{ valid, blocked, blockedHint, sent, submitLabel, onCancel }} />
      {sent.error ? <Alert variant="destructive">{sent.error}</Alert> : null}
    </form>
  );
}
