import { Bot, Terminal } from 'lucide-react';
import { specialistOption } from '../../../shared/lib/catalog/specialists.ts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ActionKind } from '../../../shared/lib/pipeline/pipelineEntries.ts';
import type { SpecialistOption } from '../../../shared/lib/specialistLabels.ts';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Card } from '../../../shared/ui/layout/card.tsx';
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
import { SpecialistSelect } from '../form/steps/SpecialistSelect.tsx';
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

function SectionCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card>
      <section aria-labelledby={id} className="flex flex-col gap-3 p-4">
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
        {children}
      </section>
    </Card>
  );
}

function CommandCard({ draft, disabled, update, errorsOf }: FieldsProps) {
  const { t } = useTranslation();
  return (
    <SectionCard id="action-section-command" title={t('pipeline.actions.sectionCommand')}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="field-action-run">{t('pipeline.actions.script')}</Label>
        <Textarea
          id="field-action-run"
          className="field-sizing-content font-mono"
          rows={6}
          spellCheck={false}
          value={draft.script}
          disabled={disabled}
          placeholder={'npm run lint\nnpm test'}
          onChange={(event) => update({ script: event.target.value })}
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
    </SectionCard>
  );
}

function SpecialistCard({
  draft,
  disabled,
  update,
  errorsOf,
  options,
}: FieldsProps & { options: SpecialistOption[] }) {
  const { t } = useTranslation();
  return (
    <SectionCard id="action-section-specialist" title={t('pipeline.actions.sectionSpecialist')}>
      <div className="flex flex-col gap-1.5">
        <Label>{t('pipeline.actions.specialistField')}</Label>
        <SpecialistSelect
          current={draft.specialist}
          options={options}
          label={t('pipeline.actions.specialistLabel')}
          disabled={disabled}
          onChange={(next) => update({ specialist: next })}
        />
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
    </SectionCard>
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
        <SelectTrigger aria-label={t('pipeline.actions.onFailureLabel')} className="w-full">
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

/** The cards of an action: the main one and the one of its type; the form lays them out. */
export function ActionFields(
  props: FieldsProps & {
    options: SpecialistOption[];
    newId: string | null;
    onNewId: (id: string) => void;
  },
) {
  const { t } = useTranslation();
  const { draft, disabled, update, errorsOf } = props;
  return (
    <>
      <SectionCard id="action-section-main" title={t('pipeline.actions.sectionMain')}>
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
            className="self-start"
            value={draft.kind}
            aria-labelledby="action-kind-label"
            onValueChange={(next) => {
              if (next) update({ kind: next as ActionKind });
            }}
          >
            <ToggleGroupItem value="command" disabled={disabled}>
              <Terminal />
              {t('pipeline.actions.command')}
            </ToggleGroupItem>
            <ToggleGroupItem value="specialist" disabled={disabled}>
              <Bot />
              {t('pipeline.actions.specialist')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <FailureField {...props} />
      </SectionCard>
      {draft.kind === 'command' ? <CommandCard {...props} /> : <SpecialistCard {...props} />}
    </>
  );
}
