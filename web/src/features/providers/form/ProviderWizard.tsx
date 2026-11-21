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
import { ProviderHeader } from '../editor/ProviderHeader.tsx';
import { useMakeDefault } from '../editor/useMakeDefault.ts';
import { ProviderSections } from '../editor/ProviderSections.tsx';
import { AccessStep } from './AccessStep.tsx';
import { FORM_STEPS, type FormStep, type ProviderDraft } from './draft.ts';
import { StepIndicator, useErrorText } from './FormParts.tsx';
import { ModelsStep } from './ModelsStep.tsx';
import { NameStep } from './NameStep.tsx';
import { useDefaultProvider } from '../editor/useDefaultProvider.ts';
import { overriddenOf } from '../page/sources.ts';
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
  if (reference.setting === 'default_provider') return t('providers.form.refDefault');
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

/** Back and cancel on the left; Next, or Save on the last step, on the right (a new provider). */
function Footer(props: {
  step: FormStep;
  busy: boolean;
  stepValid: boolean;
  allValid: boolean;
  onStep: (step: FormStep) => void;
  onSave: () => void;
  onCancel: (() => void) | undefined;
}) {
  const { step, busy, onStep } = props;
  const { t } = useTranslation();
  const at = FORM_STEPS.indexOf(step);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2">
        {at > 0 ? (
          <Button variant="outline" onClick={() => onStep(FORM_STEPS[at - 1]!)}>
            {t('providers.form.back')}
          </Button>
        ) : null}
        {props.onCancel ? (
          <Button variant="outline" onClick={props.onCancel}>
            {t('common.cancel')}
          </Button>
        ) : null}
      </div>
      {at < FORM_STEPS.length - 1 ? (
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
    onNameChange: (patch: Partial<ProviderDraft>) => void;
  },
) {
  const { api, repository, slug, registry, form, errorOf, onNameChange } = props;
  const draft = form.draft!;
  const roles = registry?.roles ?? [];
  const sections: Record<FormStep, ReactNode> = {
    name: (
      <NameStep
        draft={draft}
        isNew={form.isNew}
        errorOf={errorOf}
        onChange={onNameChange}
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
  return <ProviderSections sections={sections} />;
}

/** The line while the draft is not here: loading, or the provider does not exist. */
function Waiting({ missing, slug }: { missing: boolean; slug: string | null }) {
  const { t } = useTranslation();
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {missing ? t('providers.form.notFound', { slug: slug ?? '' }) : t('providers.loading')}
    </p>
  );
}

/** The question before a delete, and the delete itself when it is confirmed. */
function deleteAsk(
  confirm: ReturnType<typeof useConfirm>,
  t: TFunction,
  name: string,
  remove: () => Promise<void>,
  overriding: boolean,
) {
  return () =>
    void confirm({
      title: t(overriding ? 'providers.form.removeOverrideTitle' : 'providers.form.deleteTitle', {
        name,
      }),
      description: t(
        overriding
          ? 'providers.form.removeOverrideDescription'
          : 'providers.form.deleteDescription',
      ),
      confirmLabel: overriding ? t('providers.removeOverride') : t('providers.form.delete'),
      destructive: true,
    }).then((ok) => (ok ? remove() : undefined));
}

/**
 * The form of a provider. A new one goes through the steps «General», «Access», «Models»; an existing one is
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
  const defaults = useDefaultProvider(api, repository);
  const form = useProviderForm({
    ...props,
    initial: props.initial ?? null,
    onDeleted: props.onDeleted ?? (() => {}),
    assignDefault: defaults.assign,
  });
  const { draft } = form;
  const onNameChange = useMakeDefault(defaults, form.setDraft, draft);
  const errorOf = useErrorText(
    Object.assign({}, ...FORM_STEPS.map((step) => form.errorsOf(step))),
    form.problems.fields,
  );
  if (!draft) return <Waiting missing={editor !== null && slug !== null} slug={slug} />;
  const live = registry?.providers.find((item) => item.slug === slug);
  const allValid = FORM_STEPS.every((step) => form.stepValid(step));
  const overriding = overriddenOf(editor?.providers.find((item) => item.slug === slug));
  const onDelete = deleteAsk(confirm, t, draft.name, form.remove, overriding);
  return (
    <form
      className="flex flex-col gap-4"
      aria-label={t('providers.form.label')}
      onSubmit={(event) => event.preventDefault()}
    >
      {!form.isNew && slug !== null ? (
        <ProviderHeader
          slug={slug}
          live={live}
          draftName={draft.name}
          busy={form.busy}
          canSave={allValid}
          onSave={() => void form.save()}
          onDelete={onDelete}
          defaults={defaults}
          locked={form.locked}
          overriding={overriding}
          strips={form.strips}
          onOverride={() => void form.override()}
        />
      ) : null}
      <Problems problems={form.problems} />
      {/* a disabled fieldset turns off every field and button inside: a shared provider is view only */}
      <fieldset
        disabled={form.locked}
        className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
        data-locked={form.locked ? 'true' : undefined}
      >
        <WizardBody {...props} form={form} errorOf={errorOf} onNameChange={onNameChange} />
      </fieldset>
      {form.isNew ? (
        <Footer
          step={form.step}
          busy={form.busy}
          stepValid={form.stepValid(form.step)}
          allValid={allValid}
          onStep={form.setStep}
          onSave={() => void form.save()}
          onCancel={props.onCancel}
        />
      ) : null}
    </form>
  );
}
