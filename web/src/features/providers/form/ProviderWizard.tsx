import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type {
  ConfigEditorResponse,
  EntryReference,
  ProvidersView,
} from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import { ProviderStatusBadge } from '../list/ProviderStatus.tsx';
import { reasonsOf } from '../list/ProvidersList.tsx';
import { AccessStep } from './AccessStep.tsx';
import { FORM_STEPS, type FormStep, type ProviderDraft } from './draft.ts';
import { StepIndicator, useErrorText } from './FormParts.tsx';
import { ModelsStep } from './ModelsStep.tsx';
import { NameStep } from './NameStep.tsx';
import { presetDraft, type PresetId } from './presets.ts';
import { useProviderForm, type FormProblems } from './useProviderForm.ts';

/** A place that still uses the provider, as a line: «chain thinking, item 2». */
export function referenceText(reference: EntryReference, t: TFunction): string {
  if (reference.chain !== undefined) {
    return t('providers.form.refChain', {
      chain: reference.chain,
      item: (reference.item ?? 0) + 1,
    });
  }
  const parts = [reference.pipeline, reference.step, reference.specialist, reference.action];
  return parts.filter((part) => part !== undefined).join(' / ');
}

/** Errors without a field, and the places that use the provider when a delete was refused. */
function Problems({ problems }: { problems: FormProblems }) {
  const { t } = useTranslation();
  return (
    <>
      {problems.general.length > 0 ? (
        <Alert variant="destructive" role="alert">
          {problems.general.join('\n')}
        </Alert>
      ) : null}
      {problems.references.length > 0 ? (
        <Alert variant="destructive" role="alert">
          <p>{t('providers.form.usedBy')}</p>
          <ul className="list-disc pl-5">
            {problems.references.map((reference, index) => (
              <li key={index}>{referenceText(reference, t)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </>
  );
}

/** Back, cancel and delete on the left; Next, or Save on the last step, on the right. */
function Footer(props: {
  isNew: boolean;
  step: FormStep;
  busy: boolean;
  stepValid: boolean;
  allValid: boolean;
  onStep: (step: FormStep) => void;
  onSave: () => void;
  onDelete: () => void;
  onCancel: (() => void) | undefined;
}) {
  const { isNew, step, busy, onStep } = props;
  const { t } = useTranslation();
  const at = FORM_STEPS.indexOf(step);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2">
        {isNew && at > 0 ? (
          <Button variant="outline" onClick={() => onStep(FORM_STEPS[at - 1]!)}>
            {t('providers.form.back')}
          </Button>
        ) : null}
        {props.onCancel ? (
          <Button variant="outline" onClick={props.onCancel}>
            {t('common.cancel')}
          </Button>
        ) : null}
        {!isNew ? (
          <Button variant="destructive" disabled={busy} onClick={props.onDelete}>
            {t('providers.form.delete')}
          </Button>
        ) : null}
      </div>
      {isNew && at < FORM_STEPS.length - 1 ? (
        <Button disabled={!props.stepValid} onClick={() => onStep(FORM_STEPS[at + 1]!)}>
          {t('providers.form.next')}
        </Button>
      ) : (
        <Button disabled={busy || !props.allValid} onClick={props.onSave}>
          {t('providers.form.save')}
        </Button>
      )}
    </div>
  );
}

/** The step that is open (a new provider) or the three parts one under another (an existing one). */
function WizardBody(
  props: Parameters<typeof ProviderWizard>[0] & {
    form: ReturnType<typeof useProviderForm>;
    errorOf: (field: string) => string | undefined;
  },
) {
  const { api, repository, slug, registry, form, errorOf } = props;
  const { t } = useTranslation();
  const draft = form.draft!;
  const roles = registry?.roles ?? [];
  const sections: Record<FormStep, ReactNode> = {
    name: (
      <NameStep
        draft={draft}
        isNew={form.isNew}
        errorOf={errorOf}
        onChange={form.setDraft}
        onPreset={(id: PresetId) =>
          form.replaceDraft({
            ...presetDraft(
              id,
              roles.map((r) => r.slug),
            ),
            level: draft.level,
          })
        }
      />
    ),
    access: <AccessStep draft={draft} errorOf={errorOf} onChange={form.setDraft} />,
    models: (
      <ModelsStep
        api={api}
        repository={repository}
        slug={slug}
        roles={roles}
        draft={draft}
        onChange={form.setDraft}
      />
    ),
  };
  if (form.isNew) {
    return (
      <>
        <StepIndicator step={form.step} onStep={form.setStep} />
        {sections[form.step]}
      </>
    );
  }
  return FORM_STEPS.map((step) => (
    <section
      key={step}
      aria-label={t(`providers.form.step.${step}`)}
      className="flex flex-col gap-3"
    >
      <h3 className="text-sm font-semibold">{t(`providers.form.step.${step}`)}</h3>
      {sections[step]}
    </section>
  ));
}

/**
 * The form of a provider. A new one goes through the steps «Name», «Access», «Models»; an existing one is
 * one page with the three parts, its slug and level read only. The same component is the page
 * `#providers/new` and the dialog «Create provider…».
 */
export function ProviderWizard(props: {
  api: Api;
  repository: string | null;
  /** The slug of the provider to edit; null: a new one. */
  slug: string | null;
  initial?: ProviderDraft | null;
  registry: ProvidersView | null;
  editor: ConfigEditorResponse | null;
  onSaved: (slug: string) => void;
  onDeleted?: () => void;
  onCancel?: () => void;
}) {
  const { api, repository, slug, registry, editor } = props;
  const { t } = useTranslation();
  const confirm = useConfirm();
  const form = useProviderForm({
    ...props,
    initial: props.initial ?? null,
    onDeleted: props.onDeleted ?? (() => {}),
  });
  const { draft } = form;
  const errorOf = useErrorText(
    Object.assign({}, ...FORM_STEPS.map((step) => form.errorsOf(step))),
    form.problems.fields,
  );
  if (!draft) {
    const text =
      editor && slug !== null ? t('providers.form.notFound', { slug }) : t('providers.loading');
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {text}
      </p>
    );
  }
  const live = registry?.providers.find((item) => item.slug === slug);
  return (
    <form
      className="flex flex-col gap-4"
      aria-label={t('providers.form.label')}
      onSubmit={(event) => event.preventDefault()}
    >
      <Problems problems={form.problems} />
      {live ? <ProviderStatusBadge status={live.status} reasons={reasonsOf(live)} /> : null}
      <WizardBody {...props} form={form} errorOf={errorOf} />
      <Footer
        isNew={form.isNew}
        step={form.step}
        busy={form.busy}
        stepValid={form.stepValid(form.step)}
        allValid={FORM_STEPS.every((step) => form.stepValid(step))}
        onStep={form.setStep}
        onSave={() => void form.save()}
        onDelete={() =>
          void confirm({
            title: t('providers.form.deleteTitle', { name: draft.name }),
            description: t('providers.form.deleteDescription'),
            confirmLabel: t('providers.form.delete'),
            destructive: true,
          }).then((ok) => (ok ? form.remove() : undefined))
        }
        onCancel={props.onCancel}
      />
    </form>
  );
}
