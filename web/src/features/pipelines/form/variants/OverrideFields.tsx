import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse, FieldError } from '../../../../shared/api/types.ts';
import { Input } from '../../../../shared/ui/forms/input.tsx';
import { Label } from '../../../../shared/ui/forms/label.tsx';
import { ModelField } from '../../../../shared/ui/forms/picker/ModelField.tsx';
import { REASONING_EFFORTS } from '../../../specialists/index.ts';
import { ChoiceSelect } from './ChoiceSelect.tsx';
import { EXECUTOR_FIELDS, patchOverride, type OverrideDraft } from './variantDraft.ts';

type SpecialistView = ConfigEditorResponse['specialists'][number];

export function Errors({ errors }: { errors: FieldError[] }) {
  return errors.map((error) => (
    <p className="text-sm text-destructive" role="alert" key={`${error.path}:${error.message}`}>
      {error.message}
    </p>
  ));
}

/** One labelled field of the card with its errors. */
export function Field({
  label,
  htmlFor,
  errors,
  children,
}: {
  label: string;
  htmlFor?: string;
  errors: FieldError[];
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      <Errors errors={errors} />
    </div>
  );
}

export function Choice({
  field,
  label,
  value,
  items,
  hint,
  view,
  onChange,
}: {
  field: string;
  label: string;
  value: string | undefined;
  items: { value: string; label: string }[];
  hint: string;
  view: FieldsView;
  onChange: (next: string | undefined) => void;
}) {
  const errors = view.on(field);
  return (
    <Field label={label} errors={errors}>
      <ChoiceSelect
        label={label}
        value={value}
        options={items}
        hint={hint}
        disabled={view.disabled}
        invalid={errors.length > 0}
        onChange={onChange}
      />
    </Field>
  );
}

export interface FieldsView {
  on: (field: string) => FieldError[];
  disabled: boolean;
  set: (patch: Partial<OverrideDraft>) => void;
  base: ConfigEditorResponse['specialists'][number]['effective'] | null;
  runtime: string;
}

/** The value of the chain select that stands for «no chain»: the executor fields apply. */
const NO_CHAIN = '__none';

const own = (next: string): string | undefined => (next === '' ? undefined : next);

export function chainInfo(
  view: ConfigEditorResponse,
  specialist: SpecialistView | undefined,
  override: OverrideDraft,
) {
  const slug = override.runtimeChain ?? (specialist?.raw.runtime_chain as string | undefined);
  const chain = view.chains.find((candidate) => candidate.slug === slug);
  const executorSet = EXECUTOR_FIELDS.some((field) => override[field] !== undefined);
  return {
    inherited: Boolean(specialist?.raw.runtime_chain),
    executorSet,
    // A chain runs the step: its own, or the specialist's while no executor field replaces it.
    chainRuns: Boolean(override.runtimeChain) || (Boolean(slug) && !executorSet),
    label: chain ? `${String(chain.raw.name || chain.slug)} (${chain.slug})` : (slug ?? ''),
  };
}

/** The model and, for OpenCode, the effort and the model variant. */
export function ModelFields({
  idPrefix,
  override,
  view,
}: {
  idPrefix: string;
  override: OverrideDraft;
  view: FieldsView;
}) {
  const { t } = useTranslation();
  const { base, runtime, set, on, disabled } = view;
  return (
    <>
      <Field label={t('variants.model')} htmlFor={`${idPrefix}-model`} errors={on('model')}>
        <ModelField
          id={`${idPrefix}-model`}
          runtime={runtime}
          label={t('variants.model')}
          value={override.model ?? ''}
          disabled={disabled}
          invalid={on('model').length > 0}
          placeholder={base?.model ?? t('variants.asInPipeline')}
          onChange={(next) => set({ model: own(next) })}
        />
      </Field>
      {runtime === 'opencode' ? (
        <>
          <Choice
            field="reasoning_effort"
            label={t('variants.effort')}
            value={override.reasoningEffort}
            items={REASONING_EFFORTS.map((item) => ({ value: item, label: item }))}
            hint={base?.reasoning_effort ?? ''}
            view={view}
            onChange={(next) => set({ reasoningEffort: next })}
          />
          <Field
            label={t('variants.modelVariant')}
            htmlFor={`${idPrefix}-variant`}
            errors={on('variant')}
          >
            <Input
              id={`${idPrefix}-variant`}
              type="text"
              value={override.variant ?? ''}
              placeholder={base?.variant ?? t('variants.asInPipeline')}
              disabled={disabled}
              aria-invalid={on('variant').length > 0}
              onChange={(event) => set({ variant: own(event.target.value) })}
            />
          </Field>
        </>
      ) : null}
    </>
  );
}

/** The chain select: «as in the pipeline», «no chain» (an own executor) or a chain of the file. */
export function ChainField({
  override,
  view,
  fields,
  specialist,
}: {
  override: OverrideDraft;
  view: ConfigEditorResponse;
  fields: FieldsView;
  specialist: SpecialistView | undefined;
}) {
  const { t } = useTranslation();
  const { inherited, executorSet, label } = chainInfo(view, specialist, override);
  const choose = (next: string | undefined) => {
    if (next === NO_CHAIN) fields.set({ runtime: fields.base?.runtime || 'claude' });
    else if (next === undefined) {
      const cleared = { runtimeChain: undefined, runtime: undefined, model: undefined };
      fields.set({ ...cleared, variant: undefined, reasoningEffort: undefined });
    } else fields.set({ runtimeChain: next });
  };
  return (
    <Choice
      field="runtime_chain"
      label={t('variants.chain')}
      value={override.runtimeChain ?? (inherited && executorSet ? NO_CHAIN : undefined)}
      items={[
        ...(inherited ? [{ value: NO_CHAIN, label: t('variants.noChain') }] : []),
        ...view.chains.map((chain) => ({
          value: chain.slug,
          label: `${String(chain.raw.name || chain.slug)} (${chain.slug})`,
        })),
      ]}
      hint={label}
      view={fields}
      onChange={choose}
    />
  );
}
