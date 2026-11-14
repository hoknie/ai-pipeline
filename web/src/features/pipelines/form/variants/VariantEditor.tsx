import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse, FieldError } from '../../../../shared/api/types.ts';
import type { SpecialistOption } from '../../../../shared/lib/specialistLabels.ts';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import { Input } from '../../../../shared/ui/forms/input.tsx';
import { Label } from '../../../../shared/ui/forms/label.tsx';
import { SkipSteps } from '../../../../shared/ui/forms/picker/SkipSteps.tsx';
import { stepIds } from '../../stepIds.ts';
import type { Draft, StepDraft } from '../steps/draft.ts';
import { useSpecialistNames } from '../steps/SpecialistNames.ts';
import { StepOverrideCard } from './StepOverrideCard.tsx';
import { hasDuplicateId, type OverrideDraft, type VariantDraft } from './variantDraft.ts';

const PROMPT_HINT_LENGTH = 40;

function Errors({ errors }: { errors: FieldError[] }) {
  return errors.map((error) => (
    <p className="text-sm text-destructive" role="alert" key={`${error.path}:${error.message}`}>
      {error.message}
    </p>
  ));
}

/** The errors of the check that belong to the variant, by the part of it. */
function variantErrors(
  errors: FieldError[],
  pipelineId: string,
  variant: VariantDraft,
  draft: Draft,
) {
  const base = `swarm.pipelines.${pipelineId}.variants.${variant.id}`;
  const within = (error: FieldError, part: string) =>
    error.path === `${base}.${part}` || error.path.startsWith(`${base}.${part}.`);
  const delegated = Boolean(draft.split?.pipeline);
  const cards = delegated ? [] : stepIds(draft.steps).filter((id) => id !== '');
  const shown = (error: FieldError) =>
    error.path === base ||
    within(error, 'name') ||
    (!delegated && within(error, 'skip')) ||
    (draft.split !== null && within(error, 'split')) ||
    cards.some((id) => within(error, `steps.${id}`));
  const own = errors.filter((error) => error.path === base || error.path.startsWith(`${base}.`));
  return {
    id: own.filter((error) => error.path === base),
    name: own.filter((error) => within(error, 'name')),
    skip: own.filter((error) => within(error, 'skip')),
    split: own.filter((error) => within(error, 'split')),
    step: (id: string) => own.filter((error) => within(error, `steps.${id}`)),
    other: own.filter((error) => !shown(error)),
  };
}

type Found = ReturnType<typeof variantErrors>;
type Onward = (change: (current: VariantDraft) => VariantDraft) => void;

/** The card of the split and of every step. */
function OverrideCards({
  draft,
  variant,
  steps,
  options,
  view,
  disabled,
  found,
  onVariant,
}: {
  draft: Draft;
  variant: VariantDraft;
  steps: { step: StepDraft; id: string }[];
  options: SpecialistOption[];
  view: ConfigEditorResponse;
  disabled: boolean;
  found: Found;
  onVariant: Onward;
}) {
  const { t } = useTranslation();
  const hint = (text: string) =>
    text.length > PROMPT_HINT_LENGTH ? `${text.slice(0, PROMPT_HINT_LENGTH)}…` : text;
  const delegated = Boolean(draft.split?.pipeline);
  const setStep = (key: number, next: OverrideDraft) =>
    onVariant((current) => ({ ...current, steps: new Map(current.steps).set(key, next) }));
  return (
    <ul className="flex flex-col gap-2" aria-label={t('variants.overrides')}>
      {draft.split ? (
        <StepOverrideCard
          idPrefix={`variant-${variant.key}-split`}
          title={t('variants.splitCard')}
          override={variant.split ?? {}}
          baseSpecialist={draft.split.specialist}
          basePrompt={hint(draft.split.additionalPrompt)}
          options={options}
          view={view}
          disabled={disabled}
          errors={found.split}
          onChange={(next) => onVariant((current) => ({ ...current, split: next }))}
        />
      ) : null}
      {delegated
        ? null
        : steps.map(({ step, id }) => (
            <StepOverrideCard
              key={step.key}
              idPrefix={`variant-${variant.key}-step-${step.key}`}
              title={t('variants.stepCard', { id })}
              override={variant.steps.get(step.key) ?? {}}
              baseSpecialist={step.specialist}
              basePrompt={hint(step.additionalPrompt)}
              options={options}
              view={view}
              disabled={disabled}
              errors={found.step(id)}
              onChange={(next) => setStep(step.key, next)}
            />
          ))}
    </ul>
  );
}

/** The skip of the steps, and the card of the split and of every step. */
function VariantCards({
  draft,
  variant,
  pipelineId,
  options,
  view,
  disabled,
  errors,
  onVariant,
}: {
  draft: Draft;
  variant: VariantDraft;
  pipelineId: string;
  options: SpecialistOption[];
  view: ConfigEditorResponse;
  disabled: boolean;
  errors: FieldError[];
  onVariant: (change: (current: VariantDraft) => VariantDraft) => void;
}) {
  const { t } = useTranslation();
  const names = useSpecialistNames();
  const found = variantErrors(errors, pipelineId, variant, draft);
  const ids = stepIds(draft.steps);
  const steps = draft.steps.flatMap((step, index) =>
    ids[index] ? [{ step, id: ids[index] }] : [],
  );
  const delegated = Boolean(draft.split?.pipeline);
  return (
    <>
      {delegated ? (
        <p className="text-sm text-muted-foreground">{t('variants.groupsFollow')}</p>
      ) : (
        <>
          <SkipSteps
            idPrefix={`variant-${variant.key}`}
            disabled={disabled}
            steps={steps.map(({ step, id }) => ({ id, name: names.get(step.specialist) ?? id }))}
            skip={steps.filter(({ step }) => variant.skipKeys.includes(step.key)).map((s) => s.id)}
            onChange={(skip) =>
              onVariant((current) => ({
                ...current,
                skipKeys: steps.filter(({ id }) => skip.includes(id)).map(({ step }) => step.key),
              }))
            }
          />
          <Errors errors={found.skip} />
        </>
      )}
      <OverrideCards
        draft={draft}
        variant={variant}
        steps={steps}
        options={options}
        view={view}
        disabled={disabled}
        found={found}
        onVariant={onVariant}
      />
    </>
  );
}

/** The id and the name of the variant. */
function IdAndName({
  variant,
  duplicate,
  disabled,
  found,
  onVariant,
}: {
  variant: VariantDraft;
  duplicate: boolean;
  disabled: boolean;
  found: Found;
  onVariant: Onward;
}) {
  const { t } = useTranslation();
  const prefix = `variant-${variant.key}`;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${prefix}-id`}>Id</Label>
        <Input
          id={`${prefix}-id`}
          type="text"
          value={variant.id}
          disabled={disabled}
          aria-invalid={found.id.length > 0 || duplicate}
          onChange={(event) => onVariant((current) => ({ ...current, id: event.target.value }))}
        />
        <Errors errors={found.id} />
        {duplicate ? (
          <p className="text-sm text-destructive" role="alert">
            {t('variants.duplicateId')}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${prefix}-name`}>{t('variants.name')}</Label>
        <Input
          id={`${prefix}-name`}
          type="text"
          value={variant.name}
          disabled={disabled}
          aria-invalid={found.name.length > 0}
          onChange={(event) => onVariant((current) => ({ ...current, name: event.target.value }))}
        />
        <Errors errors={found.name} />
      </div>
    </div>
  );
}

/** One variant: its id and name, what it skips and what it changes in each step. */
export function VariantEditor({
  draft,
  variant,
  pipelineId,
  options,
  view,
  disabled,
  errors,
  onDraft,
  onRemove,
}: {
  draft: Draft;
  variant: VariantDraft;
  pipelineId: string;
  options: SpecialistOption[];
  view: ConfigEditorResponse;
  disabled: boolean;
  errors: FieldError[];
  onDraft: (change: (current: Draft) => Draft) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const found = variantErrors(errors, pipelineId, variant, draft);
  const onVariant = (change: (current: VariantDraft) => VariantDraft) =>
    onDraft((current) => ({
      ...current,
      variants: current.variants.map((item) => (item.key === variant.key ? change(item) : item)),
    }));
  const duplicate = hasDuplicateId(draft.variants, variant);
  return (
    <section className="flex flex-col gap-3" aria-label={t('variants.section', { id: variant.id })}>
      <IdAndName
        variant={variant}
        duplicate={duplicate}
        disabled={disabled}
        found={found}
        onVariant={onVariant}
      />
      <Errors errors={found.other} />
      <VariantCards
        draft={draft}
        variant={variant}
        pipelineId={pipelineId}
        options={options}
        view={view}
        disabled={disabled}
        errors={errors}
        onVariant={onVariant}
      />
      <div>
        <Button variant="outline" disabled={disabled} onClick={onRemove}>
          <Trash2 aria-hidden />
          {t('variants.remove')}
        </Button>
      </div>
    </section>
  );
}
