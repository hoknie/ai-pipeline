import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import { cn } from '../../shared/lib/browser/cn.ts';

import type { Api } from '../../shared/api/api.ts';
import { type LinkKind, type LinkTargetGroup } from '../runs/index.ts';
import type { DeliveryMode } from '../../../../src/feature/swarm-config/types/index.ts';
import { useTags } from '../../shared/lib/catalog/tags.tsx';
import type { QueueFields, PipelinesView } from '../../shared/api/types.ts';
import { continueDraft, draftValid, fieldsOf, type QueueDraft } from './draft.ts';
import { DuplicateNotice, useDuplicateRefusal } from './duplicate.tsx';
import { focusNewTaskField } from './form/focusNewTaskField.ts';
import { withCurrent } from './form/LinkFields.tsx';
import { SideFields } from './form/properties/SideFields.tsx';
import { useEffectiveDraft } from './form/usePresetDraft.ts';
import { TaskFields, type FormState } from './form/TaskFields.tsx';

export { draftOf, draftValid, emptyDraft, fieldsOf, retarget, type QueueDraft } from './draft.ts';

/** Ctrl/⌘+Enter sends the form like the main button does. */
function sendOnShortcut(event: KeyboardEvent<HTMLElement>, allowed: boolean, send: () => void) {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
  if (event.nativeEvent.isComposing) return;
  event.preventDefault();
  if (allowed) send();
}

function FormButtons({
  disabled,
  hint,
  label,
  onContinue,
  onCancel,
  sticky,
}: {
  disabled: boolean;
  /** Why the task cannot be added yet. */
  hint?: string | undefined;
  label: string;
  onContinue: (() => void) | undefined;
  onCancel: (() => void) | undefined;
  /** The row stays at the bottom of the scrolling dialog. */
  sticky: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t pt-3',
        sticky && 'sticky -bottom-5 z-10 -mx-3 -mb-3 bg-card px-3 pb-3',
      )}
    >
      {hint ? <span className="mr-auto text-xs text-muted-foreground">{hint}</span> : null}
      {onCancel ? (
        <Button variant="ghost" onClick={onCancel}>
          {t('queue.form.cancel')}
        </Button>
      ) : null}
      {onContinue ? (
        <Button type="button" variant="outline" disabled={disabled} onClick={onContinue}>
          {t('queue.addAndContinue')}
        </Button>
      ) : null}
      <Button type="submit" disabled={disabled} title={hint ?? t('queue.form.submitShortcut')}>
        {label}
      </Button>
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
  const duplicate = useDuplicateRefusal(effective);
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
  const send = async (keep: boolean, allowDuplicate = false) => {
    if (!draftValid(effective) || busy) return;
    setBusy(true);
    setError(null);
    duplicate.clear();
    try {
      const draftFields = fieldsOf(
        effective,
        (id) => {
          const tag = catalog.byId.get(id);
          return tag && tag.repository === repository && !tag.task ? tag.name : undefined;
        },
        idPrefix !== 'new',
        returned,
      );
      const fields = allowDuplicate ? { ...draftFields, allowDuplicate: true } : draftFields;
      if (keep && onSubmitAndContinue) {
        await onSubmitAndContinue(fields);
        onDraft(continueDraft(effective));
        setFocusTick((tick) => tick + 1);
      } else {
        await onSubmit(fields);
      }
    } catch (failure) {
      // a copy of a waiting task has its own notice, with the way to add it all the same
      if (!duplicate.take(failure, keep)) setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return {
    submit: () => send(false),
    submitAndContinue: onSubmitAndContinue ? () => send(true) : undefined,
    busy,
    error,
    duplicate: duplicate.refusal,
    addAnyway: () => send(duplicate.refusal?.keep ?? false, true),
    // the daemon refuses an unknown or disabled provider by name: the field shows it
    providerError: error && /provider/i.test(error) ? error : undefined,
  };
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
  /** The projects whose providers the task may name; by default the repository of the task. */
  providerRepositories?: readonly string[];
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
  /** The action row sticks to the bottom of the scrolling parent (the dialog). */
  stickyActions?: boolean;
}

/** Why the last submit failed: the refusal of the daemon, or the notice of a copy with its action. */
function SubmitFailure({ sent }: { sent: ReturnType<typeof useSubmit> }) {
  return (
    <>
      {sent.error && !sent.providerError ? <Alert variant="destructive">{sent.error}</Alert> : null}
      {sent.duplicate ? (
        <DuplicateNotice
          refusal={sent.duplicate}
          busy={sent.busy}
          onAddAnyway={() => void sent.addAnyway()}
        />
      ) : null}
    </>
  );
}

function SubmitButtons({
  valid,
  blocked,
  blockedHint,
  sent,
  submitLabel,
  onCancel,
  sticky,
}: {
  valid: boolean;
  blocked: boolean;
  blockedHint: string | undefined;
  sent: ReturnType<typeof useSubmit>;
  submitLabel: string;
  onCancel: (() => void) | undefined;
  sticky: boolean;
}) {
  return (
    <FormButtons
      sticky={sticky}
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
  providerRepositories,
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
  stickyActions = false,
}: QueueFormProps) {
  const { t } = useTranslation();
  const { ids, effective, change } = useEffectiveDraft(draft, pipelines, onDraft);
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
      onKeyDown={(event) => sendOnShortcut(event, valid && !blocked, () => void sent.submit())}
    >
      <div
        className={cn(
          'grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]',
          fill && 'flex-1',
        )}
      >
        <TaskFields state={state} repositoryField={repositoryField} extras={extras} fill={fill} />
        <SideFields
          {...{ state, pipelines, repository, api, linkChoices, returnedRun, projectsPanel }}
          {...{ autoDeliverDefault, deliveryModeDefault, providerError: sent.providerError }}
          options={withCurrent(ids, effective.pipeline)}
          repositories={providerRepositories ?? (repository ? [repository] : [])}
        />
      </div>
      <SubmitFailure sent={sent} />
      <SubmitButtons
        {...{ valid, blocked, blockedHint, sent, submitLabel, onCancel }}
        sticky={stickyActions}
      />
    </form>
  );
}
