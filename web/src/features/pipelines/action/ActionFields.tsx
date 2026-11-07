import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ActionKind } from '../../../shared/lib/pipeline/pipelineEntries.ts';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui/forms/select.tsx';
import { Textarea } from '../../../shared/ui/forms/textarea.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../../shared/ui/forms/toggle-group.tsx';
import type { ActionDraft, Field } from './actionDraft.ts';

/** Radix `Select` has no empty value: this one stands for «nothing chosen». */
const NONE = '__none';

export interface FieldsProps {
  draft: ActionDraft;
  disabled: boolean;
  update: (patch: Partial<ActionDraft>) => void;
  /** The error lines under a field. */
  errorsOf: (field: Field) => ReactNode;
}

function CommandFields({ draft, disabled, update, errorsOf }: FieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="field-action-run">{t('pipeline.actions.run')}</Label>
        <Textarea
          id="field-action-run"
          rows={3}
          className="font-mono"
          value={draft.run}
          disabled={disabled}
          placeholder='git commit -am "$AIP_COMMIT_MESSAGE"'
          onChange={(event) => update({ run: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('pipeline.actions.runHelp')}</p>
        {errorsOf('run')}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="field-action-timeout">{t('pipeline.actions.timeout')}</Label>
        <Input
          id="field-action-timeout"
          type="text"
          className="w-32"
          value={draft.timeout}
          disabled={disabled}
          placeholder="600"
          onChange={(event) => update({ timeout: event.target.value })}
        />
        {errorsOf('timeout')}
      </div>
    </>
  );
}

function SpecialistFields({
  draft,
  disabled,
  update,
  errorsOf,
  slugs,
}: FieldsProps & { slugs: string[] }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label>{t('pipeline.actions.specialistField')}</Label>
        <Select
          value={draft.specialist === '' ? NONE : draft.specialist}
          disabled={disabled}
          onValueChange={(next) => update({ specialist: next === NONE ? '' : next })}
        >
          <SelectTrigger aria-label={t('pipeline.actions.specialistLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {slugs.map((slug) => (
              <SelectItem key={slug} value={slug}>
                {slug}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errorsOf('specialist')}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="field-action-prompt">{t('pipeline.actions.prompt')}</Label>
        <Textarea
          id="field-action-prompt"
          rows={3}
          value={draft.additionalPrompt}
          disabled={disabled}
          onChange={(event) => update({ additionalPrompt: event.target.value })}
        />
        {errorsOf('additional_prompt')}
      </div>
    </>
  );
}

function FailureField({ draft, disabled, update, errorsOf }: FieldsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{t('pipeline.actions.onFailure')}</Label>
      <Select
        value={draft.onFailure === '' ? NONE : draft.onFailure}
        disabled={disabled}
        onValueChange={(next) =>
          update({ onFailure: next === NONE ? '' : (next as 'stop' | 'continue') })
        }
      >
        <SelectTrigger aria-label={t('pipeline.actions.onFailureLabel')} className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('pipeline.actions.failureDefault')}</SelectItem>
          <SelectItem value="stop">{t('pipeline.actions.failureStop')}</SelectItem>
          <SelectItem value="continue">{t('pipeline.actions.failureContinue')}</SelectItem>
        </SelectContent>
      </Select>
      {errorsOf('on_failure')}
    </div>
  );
}

/** The fields of an action: the id of a new one, the name, the kind and what the kind needs. */
export function ActionFields(
  props: FieldsProps & { slugs: string[]; newId: string | null; onNewId: (id: string) => void },
) {
  const { t } = useTranslation();
  const { draft, disabled, update, errorsOf } = props;
  return (
    <>
      {props.newId !== null ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="field-action-id">Id</Label>
          <Input
            id="field-action-id"
            type="text"
            value={props.newId}
            disabled={disabled}
            placeholder="commit"
            onChange={(event) => props.onNewId(event.target.value)}
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="field-action-name">{t('pipeline.actions.name')}</Label>
        <Input
          id="field-action-name"
          type="text"
          value={draft.name}
          disabled={disabled}
          onChange={(event) => update({ name: event.target.value })}
        />
        {errorsOf('name')}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label id="action-kind-label">{t('pipeline.actions.kind')}</Label>
        <ToggleGroup
          type="single"
          value={draft.kind}
          aria-labelledby="action-kind-label"
          onValueChange={(next) => {
            if (next) update({ kind: next as ActionKind });
          }}
        >
          <ToggleGroupItem value="command" disabled={disabled}>
            {t('pipeline.actions.command')}
          </ToggleGroupItem>
          <ToggleGroupItem value="specialist" disabled={disabled}>
            {t('pipeline.actions.specialist')}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {draft.kind === 'command' ? <CommandFields {...props} /> : <SpecialistFields {...props} />}
      <FailureField {...props} />
    </>
  );
}
