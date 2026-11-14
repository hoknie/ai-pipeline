import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { PipelinesView, RunView } from '../../shared/api/types.ts';
import { ToggleGroup, ToggleGroupItem } from '../../shared/ui/forms/toggle-group.tsx';
import { liveState } from './topologyLayout.ts';

/** The variants of the pipeline with the number of their active runs; none without variants. */
export function VariantChoice({
  pipeline,
  runs,
  repository,
  selected,
  onSelect,
}: {
  pipeline: PipelinesView['pipelines'][number];
  runs: RunView[];
  repository: string | null;
  selected: string;
  onSelect: (variant: string) => void;
}) {
  const { t } = useTranslation();
  if (pipeline.variants.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>{t('variants.topologyLabel')}</span>
      <ToggleGroup
        type="single"
        className="h-auto flex-wrap"
        aria-label={t('variants.topologyLabel')}
        value={selected}
        onValueChange={(value) => value && onSelect(value)}
      >
        {pipeline.variants.map((variant) => (
          <ToggleGroupItem key={variant.id} value={variant.id} title={variant.id}>
            {variant.name}{' '}
            <span className="text-xs text-muted-foreground">
              {t('variants.topologyRuns', {
                count: liveState(pipeline, runs, repository, variant.id).runs,
              })}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** The pipeline as the chosen variant shows it: its steps (skipped ones marked) and its split. */
function variantOf(
  pipeline: PipelinesView['pipelines'][number] | null,
  variant: string | null,
): { pipeline: PipelinesView['pipelines'][number] | null; id: string } {
  const found = pipeline?.variants.find((candidate) => candidate.id === variant);
  if (!pipeline || !found || pipeline.variants.length < 2) {
    return { pipeline, id: found?.id ?? 'default' };
  }
  return { pipeline: { ...pipeline, steps: found.steps, split: found.split }, id: found.id };
}

/** The chosen pipeline as the chosen variant shows it, and what runs are doing in it. */
export function useChosen(
  view: PipelinesView | null,
  runs: RunView[],
  selectedId: string | null,
  variantInAddress: string | null,
  onSelectVariant: ((variant: string | null) => void) | undefined,
) {
  const base =
    view?.pipelines.find((candidate) => candidate.id === selectedId) ?? view?.pipelines[0] ?? null;
  const { pipeline, id: variantId } = useMemo(
    () => variantOf(base, variantInAddress),
    [base, variantInAddress],
  );
  const unknownVariant =
    variantInAddress !== null &&
    base !== null &&
    !base.variants.some((candidate) => candidate.id === variantInAddress);
  useEffect(() => {
    if (unknownVariant) onSelectVariant?.(null);
  }, [unknownVariant, onSelectVariant]);
  const live = useMemo(
    () =>
      pipeline
        ? liveState(
            pipeline,
            runs,
            view?.repository ?? null,
            (base?.variants.length ?? 0) > 1 ? variantId : null,
          )
        : null,
    [pipeline, base, variantId, runs, view],
  );
  return { base, pipeline, variantId, live };
}
