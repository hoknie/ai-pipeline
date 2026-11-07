import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import { Label } from '../../shared/ui/forms/label.tsx';

import type { Api } from '../../shared/api/api.ts';
import type { DeliveryMode } from '../../../../src/feature/swarm-config/types/index.ts';
import { useTags } from '../../shared/lib/catalog/tags.tsx';
import type { QueueFields, PipelinesView } from '../../shared/api/types.ts';
import type { AfterOption, ParentChoice } from './queueLinks.ts';
import { draftValid, fieldsOf, type QueueDraft } from './draft.ts';
import { DeliveryFields } from './form/DeliveryFields.tsx';
import { AfterField, ParentField, TagsField } from './form/LinkFields.tsx';
import { TaskFields } from './form/TaskFields.tsx';

export {
  TITLE_LIMIT,
  draftOf,
  draftValid,
  emptyDraft,
  fieldsOf,
  retarget,
  type QueueDraft,
} from './draft.ts';

function FormButtons({
  disabled,
  label,
  onCancel,
}: {
  disabled: boolean;
  label: string;
  onCancel: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={disabled}>
        {label}
      </Button>
      {onCancel ? (
        <Button variant="ghost" onClick={onCancel}>
          {t('queue.form.cancel')}
        </Button>
      ) : null}
    </div>
  );
}

/** Sends the draft; a failure is kept to show next to the form. */
function useSubmit(
  effective: QueueDraft,
  repository: string | null,
  idPrefix: string,
  onSubmit: (fields: QueueFields) => Promise<void>,
) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const catalog = useTags();
  const submit = async () => {
    if (!draftValid(effective) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(
        fieldsOf(
          effective,
          (id) => {
            const tag = catalog.byId.get(id);
            return tag && tag.repository === repository && !tag.task ? tag.name : undefined;
          },
          idPrefix !== 'new',
        ),
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { submit, busy, error };
}

export function QueueForm({
  idPrefix,
  draft,
  pipelines,
  repository,
  api,
  autoDeliverDefault = null,
  deliveryModeDefault = null,
  afterChoices = [],
  parentChoices = [],
  locked = false,
  repositoryField,
  pending = false,
  submitLabel,
  onDraft,
  onSubmit,
  onCancel,
}: {
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
  /** What the task can wait for. */
  afterChoices?: AfterOption[];
  /** The runs the task can be a child of, in the order to show them. */
  parentChoices?: ParentChoice[];
  /** A returned run keeps its own task: only the predecessors can change. */
  locked?: boolean;
  /** The field of the repository, the first in the left half; only a new task has it. */
  repositoryField?: ReactNode;
  /** The data of the form is still loading: the form cannot be sent. */
  pending?: boolean;
  submitLabel: string;
  onDraft: (draft: QueueDraft) => void;
  /** Rejects with the message to show next to the form; the draft is kept then. */
  onSubmit: (fields: QueueFields) => Promise<void>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const ids = pipelines?.pipelines.map((pipeline) => pipeline.id) ?? [];
  // a draft started before the pipelines were known takes the first one
  const effective: QueueDraft =
    draft.pipeline === '' && ids[0] ? { ...draft, pipeline: ids[0] } : draft;
  const change = (patch: Partial<QueueDraft>) => onDraft({ ...effective, ...patch });
  const valid = draftValid(effective);
  const state = { idPrefix, effective, change, locked };
  const { submit, busy, error } = useSubmit(effective, repository, idPrefix, onSubmit);

  const options = [...ids];
  if (effective.pipeline !== '' && !ids.includes(effective.pipeline))
    options.push(effective.pipeline);
  return (
    <form
      className="@container flex flex-col gap-3 rounded-lg border bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void (!pending && submit());
      }}
    >
      <div className="grid gap-4 @3xl:grid-cols-2">
        <TaskFields
          state={state}
          pipelines={pipelines}
          options={options}
          repositoryField={repositoryField}
        />
        <div className="flex min-w-0 flex-col gap-3">
          <AfterField state={state} choices={afterChoices} />
          <ParentField state={state} choices={parentChoices} repository={repository} />
          <TagsField state={state} repository={repository} api={api} />
          <DeliveryFields
            state={state}
            pipelines={pipelines}
            autoDeliverDefault={autoDeliverDefault}
            deliveryModeDefault={deliveryModeDefault}
          />
        </div>
      </div>
      <FormButtons disabled={!valid || busy || pending} label={submitLabel} onCancel={onCancel} />
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </form>
  );
}
