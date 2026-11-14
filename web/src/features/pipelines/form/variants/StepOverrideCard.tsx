import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse, FieldError } from '../../../../shared/api/types.ts';
import type { SpecialistOption } from '../../../../shared/lib/specialistLabels.ts';
import { Label } from '../../../../shared/ui/forms/label.tsx';
import { Textarea } from '../../../../shared/ui/forms/textarea.tsx';
import { Card } from '../../../../shared/ui/layout/card.tsx';
import { RUNTIMES } from '../../../specialists/index.ts';
import { ChoiceSelect } from './ChoiceSelect.tsx';
import {
  ChainField,
  Choice,
  chainInfo,
  Errors,
  ModelFields,
  type FieldsView,
} from './OverrideFields.tsx';
import { patchOverride, type OverrideDraft } from './variantDraft.ts';

export interface OverrideCardProps {
  /** Unique among the cards of the form: the ids of the fields. */
  idPrefix: string;
  title: string;
  override: OverrideDraft;
  /** The slug of the specialist the pipeline has here. */
  baseSpecialist: string;
  /** The additional prompt the pipeline has here. */
  basePrompt: string;
  options: SpecialistOption[];
  view: ConfigEditorResponse;
  disabled: boolean;
  errors: FieldError[];
  onChange: (next: OverrideDraft) => void;
}

type PromptState = 'keep' | 'own' | 'remove';

const promptState = (override: OverrideDraft): PromptState =>
  override.additionalPrompt === undefined
    ? 'keep'
    : override.additionalPrompt === null
      ? 'remove'
      : 'own';

const lastKey = (path: string): string => path.slice(path.lastIndexOf('.') + 1);

/** The three states of the additional prompt: as in the pipeline, own text, removed. */
function PromptField({
  idPrefix,
  override,
  basePrompt,
  disabled,
  invalid,
  onChange,
}: Pick<OverrideCardProps, 'idPrefix' | 'override' | 'basePrompt' | 'disabled' | 'onChange'> & {
  invalid: boolean;
}) {
  const { t } = useTranslation();
  const state = promptState(override);
  const set = (next: string | null | undefined) =>
    onChange(patchOverride(override, { additionalPrompt: next }));
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${idPrefix}-prompt-state`}>{t('variants.prompt')}</Label>
      <ChoiceSelect
        id={`${idPrefix}-prompt-state`}
        label={t('variants.promptState')}
        value={state === 'keep' ? undefined : state}
        options={[
          { value: 'own', label: t('variants.promptOwn') },
          { value: 'remove', label: t('variants.promptRemove') },
        ]}
        hint={basePrompt}
        disabled={disabled}
        invalid={false}
        onChange={(next) => set(next === undefined ? undefined : next === 'remove' ? null : '')}
      />
      {state === 'own' ? (
        <Textarea
          id={`${idPrefix}-prompt`}
          aria-label={t('variants.promptText')}
          aria-invalid={invalid}
          rows={3}
          value={override.additionalPrompt ?? ''}
          disabled={disabled}
          onChange={(event) => set(event.target.value)}
        />
      ) : null}
    </div>
  );
}

/** What the variant changes in one step or in the split; a field left alone is not written. */
export function StepOverrideCard(props: OverrideCardProps) {
  const { idPrefix, title, override, baseSpecialist, options, view, disabled, errors } = props;
  const { t } = useTranslation();
  const specialist = view.specialists.find(
    (candidate) => candidate.slug === (override.specialist ?? baseSpecialist),
  );
  const base = specialist?.effective ?? null;
  const { chainRuns } = chainInfo(view, specialist, override);
  const fields: FieldsView = {
    on: (field) => errors.filter((error) => lastKey(error.path) === field),
    disabled,
    set: (patch) => props.onChange(patchOverride(override, patch)),
    base,
    runtime: override.runtime || base?.runtime || 'claude',
  };
  const known = new Set(['specialist', 'runtime', 'model', 'variant', 'reasoning_effort']);
  known.add('runtime_chain').add('additional_prompt');
  return (
    <li aria-label={title}>
      <Card className="flex flex-col gap-2 p-3">
        <h4 className="text-sm font-semibold">{title}</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <Choice
            field="specialist"
            label={t('variants.specialist')}
            value={override.specialist}
            items={options.map((option) => ({ value: option.slug, label: option.label }))}
            hint={options.find((option) => option.slug === baseSpecialist)?.label ?? baseSpecialist}
            view={fields}
            onChange={(next) => fields.set({ specialist: next })}
          />

          <ChainField override={override} view={view} fields={fields} specialist={specialist} />
          {!chainRuns ? (
            <>
              <Choice
                field="runtime"
                label={t('variants.runtime')}
                value={override.runtime}
                items={RUNTIMES.map((item) => ({ value: item, label: item }))}
                hint={base?.runtime ?? ''}
                view={fields}
                onChange={(next) => fields.set({ runtime: next })}
              />
              <ModelFields idPrefix={idPrefix} override={override} view={fields} />
            </>
          ) : null}
        </div>
        <PromptField
          idPrefix={idPrefix}
          override={override}
          basePrompt={props.basePrompt}
          disabled={disabled}
          invalid={fields.on('additional_prompt').length > 0}
          onChange={props.onChange}
        />
        <Errors errors={fields.on('additional_prompt')} />
        <Errors errors={errors.filter((error) => !known.has(lastKey(error.path)))} />
      </Card>
    </li>
  );
}
