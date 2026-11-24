import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { Label } from '../../../../shared/ui/forms/label.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../shared/ui/forms/select.tsx';
import { SkipSteps, pruneSkip } from '../../../../shared/ui/forms/picker/SkipSteps.tsx';
import type { Api } from '../../../../shared/api/api.ts';
import type { PipelinesView } from '../../../../shared/api/types.ts';
import { ProviderPicker, useCommonProviders } from '../../../providers/index.ts';
import { stepsOf } from '../../draft.ts';
import { SwitchRow } from './FormSection.tsx';
import type { FormState } from '../TaskFields.tsx';

function PipelineSelect({
  state,
  pipelines,
  options,
}: {
  state: FormState;
  pipelines: PipelinesView | null;
  options: string[];
}) {
  const { t } = useTranslation();
  const { idPrefix, effective, change, locked } = state;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`${idPrefix}-pipeline`}>{t('queue.form.pipeline')}</Label>
      <Select
        value={effective.pipeline}
        onValueChange={(pipeline) =>
          change({
            pipeline,
            variant: 'default',
            skip: pruneSkip(
              effective.skip,
              stepsOf(pipelines?.pipelines.find((candidate) => candidate.id === pipeline)).map(
                (step) => step.id,
              ),
            ),
          })
        }
        disabled={locked || options.length === 0}
      >
        <SelectTrigger id={`${idPrefix}-pipeline`} className="w-full">
          <SelectValue placeholder={t('queue.form.noPipeline')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((id) => (
            <SelectItem key={id} value={id}>
              {pipelines?.pipelines.find((candidate) => candidate.id === id)?.name ?? id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function VariantSelect({
  state,
  pipelines,
}: {
  state: FormState;
  pipelines: PipelinesView | null;
}) {
  const { t } = useTranslation();
  const { idPrefix, effective, change } = state;
  const variants =
    pipelines?.pipelines.find((candidate) => candidate.id === effective.pipeline)?.variants ?? [];
  // A pipeline with only `default` has nothing to choose.
  if (variants.length <= 1) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`${idPrefix}-variant`}>{t('queue.form.variant')}</Label>
      <Select value={effective.variant} onValueChange={(variant) => change({ variant })}>
        <SelectTrigger id={`${idPrefix}-variant`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {variants.map((variant) => (
            <SelectItem key={variant.id} value={variant.id}>
              {variant.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The provider of the run the task follows: a choice among the providers of the registry. */
function ProviderSelect({
  state,
  api,
  repositories,
  error,
}: {
  state: FormState;
  api: Api;
  repositories: readonly string[];
  error?: string | undefined;
}) {
  const { t } = useTranslation();
  const { idPrefix, effective, change } = state;
  const { providers, loaded, defaultProvider } = useCommonProviders(api, repositories);
  // a field the user has not touched follows the default provider of the project(s)
  const untouched = idPrefix === 'new' && effective.providerTouched === false;
  const follow = loaded && untouched && effective.provider !== defaultProvider;
  useEffect(() => {
    if (follow) change({ provider: defaultProvider });
    // `change` is a new function on every render; the choice itself is the dependency. A draft
    // that moves to another project meanwhile may put the provider back: the effect runs again.
  }, [follow, defaultProvider, effective.provider, effective.repository]);
  if (loaded && providers.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" title={t('queue.form.providerHint')}>
      <Label htmlFor={`${idPrefix}-provider`}>{t('queue.form.provider')}</Label>
      <ProviderPicker
        id={`${idPrefix}-provider`}
        label={t('queue.form.provider')}
        value={effective.provider}
        onChange={(provider) => change({ provider, providerTouched: true })}
        providers={providers}
        defaultSlug={defaultProvider}
        emptyLabel={t('queue.form.noProvider')}
        repository={repositories[0] ?? null}
        api={api}
        invalid={error !== undefined}
        disabled={!loaded}
      />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The «Run» section: pipeline, variant, provider, postponing and the steps to skip. */
export function RunFields(props: {
  state: FormState;
  pipelines: PipelinesView | null;
  options: string[];
  api: Api | undefined;
  repositories: readonly string[];
  /** The error of the daemon about the provider. */
  providerError?: string | undefined;
}) {
  const { t } = useTranslation();
  const { state, pipelines } = props;
  const { idPrefix, effective, change, locked } = state;
  const pipeline = pipelines?.pipelines.find((candidate) => candidate.id === effective.pipeline);
  return (
    <>
      <PipelineSelect state={state} pipelines={pipelines} options={props.options} />
      {/* a returned run keeps its task but may follow another variant */}
      <VariantSelect state={state} pipelines={pipelines} />
      {/* a returned run keeps its provider: the field is for a task that waits */}
      {locked || !props.api ? null : (
        <ProviderSelect
          state={state}
          api={props.api}
          repositories={props.repositories}
          error={props.providerError}
        />
      )}
      <fieldset disabled={locked} className="contents">
        {idPrefix === 'new' ? (
          <SwitchRow
            id={`${idPrefix}-postponed`}
            label={t('queue.form.postpone')}
            checked={effective.postponed === true}
            onCheckedChange={(postponed) => change({ postponed })}
            hint={t('queue.list.activeHint')}
          />
        ) : null}
        <SkipSteps
          idPrefix={idPrefix}
          steps={stepsOf(pipeline)}
          skip={effective.skip}
          variantSkip={
            pipeline?.variants.find((variant) => variant.id === effective.variant)?.skip ?? []
          }
          onChange={(skip) => change({ skip })}
        />
      </fieldset>
    </>
  );
}
