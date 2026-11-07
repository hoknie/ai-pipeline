import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import { formatRoute } from '../../shared/lib/nav/route.ts';
import type { RunView, PipelinesView } from '../../shared/api/types.ts';

import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';

import { ConfigErrors, EntryList, SplitPage } from '../../shared/ui/layout/EntryList.tsx';
import { StatusBadge } from '../../shared/ui/feedback/StatusBadge.tsx';
import { PipelineGraph } from './PipelineGraph.tsx';
import { machineLoad } from '../../shared/lib/pipeline/specialistLoad.ts';
import { liveState, type LiveGroup, type StageNode } from './topologyLayout.ts';
import { TopologyAside } from './TopologyAside.tsx';

function liveCounts(
  pipelines: PipelinesView['pipelines'],
  runs: RunView[],
  repository: string | null,
): Map<string, number> {
  return new Map(
    pipelines.map((candidate) => [candidate.id, liveState(candidate, runs, repository).runs]),
  );
}

function pipelineEntries(
  pipelines: PipelinesView['pipelines'],
  counts: Map<string, number>,
  t: TFunction,
) {
  return pipelines.map((candidate) => ({
    id: candidate.id,
    title: candidate.name,
    hint: candidate.id,
    subtitle: candidate.steps.map((step) => step.name).join(' → '),
    extra: counts.get(candidate.id) ? (
      <StatusBadge
        status="running"
        label={t('topology.active', { n: counts.get(candidate.id) ?? 0 })}
      />
    ) : (
      <span className="text-xs text-muted-foreground">{t('topology.noActive')}</span>
    ),
  }));
}

function PipelineHeader({
  pipeline,
  repository,
  runs,
  onEdit,
}: {
  pipeline: PipelinesView['pipelines'][number];
  repository: string | undefined;
  runs: number;
  onEdit: ((id: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold" title={pipeline.id}>
          {pipeline.name}
        </h2>
        {onEdit ? (
          <Button variant="link" size="sm" asChild>
            <a
              href={formatRoute({
                view: 'pipelines',
                run: pipeline.id,
                group: null,
                step: null,
                tab: null,
              })}
              onClick={(event) => {
                event.preventDefault();
                onEdit(pipeline.id);
              }}
            >
              {t('topology.edit')}
            </a>
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
        <span>{repository}</span>
        <span>{t('topology.delivery', { mode: pipeline.delivery.mode })}</span>
        {runs > 0 ? (
          <span>{t('topology.activeRuns', { n: runs })}</span>
        ) : (
          <span>{t('topology.noActive')}</span>
        )}
      </div>
    </header>
  );
}

/** The pipelines of the repository, loaded once. */
function usePipelinesView(api: Api): { view: PipelinesView | null; failure: string | null } {
  const [view, setView] = useState<PipelinesView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    api.pipelines().then(
      (next) => !stopped && setView(next),
      (error: Error) => !stopped && setFailure(error.message),
    );
    return () => {
      stopped = true;
    };
  }, [api]);
  return { view, failure };
}

export default function TopologyPage({
  api,
  runs,
  pipeline: selectedId,
  onSelectPipeline,
  onEditPipeline,
  onOpenGroup,
}: {
  api: Api;
  runs: RunView[];
  pipeline: string | null;
  onSelectPipeline: (id: string) => void;
  onEditPipeline?: (id: string) => void;
  onOpenGroup: (group: LiveGroup, step: string | null) => void;
}) {
  const { t } = useTranslation();
  const { view, failure } = usePipelinesView(api);
  const [selected, setSelected] = useState<string | null>(null);

  const pipeline =
    view?.pipelines.find((candidate) => candidate.id === selectedId) ?? view?.pipelines[0] ?? null;
  const counts = useMemo(
    () => liveCounts(view?.pipelines ?? [], runs, view?.repository ?? null),
    [view, runs],
  );
  const live = useMemo(
    () => (pipeline ? liveState(pipeline, runs, view?.repository ?? null) : null),
    [pipeline, runs, view],
  );
  const load = useMemo(() => machineLoad(runs), [runs]);
  const [nodes, setNodes] = useState<StageNode[]>([]);
  const node = nodes.find((candidate) => candidate.id === selected) ?? null;

  return (
    <SplitPage
      side={
        <>
          {view === null && failure === null ? (
            <div role="status" aria-label={t('topology.loading')}>
              <Skeleton className="h-16" />
            </div>
          ) : null}
          <EntryList
            label="pipeline"
            selected={pipeline?.id ?? null}
            onSelect={(id) => {
              setSelected(null);
              onSelectPipeline(id);
            }}
            entries={pipelineEntries(view?.pipelines ?? [], counts, t)}
          />
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {failure ? <Alert variant="destructive">{failure}</Alert> : null}
        {view ? <ConfigErrors errors={view.errors} /> : null}
        {pipeline && live ? (
          <section aria-label={`pipeline ${pipeline.id}`} className="flex flex-col gap-3">
            <PipelineHeader
              pipeline={pipeline}
              repository={view?.repository}
              runs={live.runs}
              onEdit={onEditPipeline}
            />
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <PipelineGraph
                pipeline={pipeline}
                live={live}
                load={load}
                selected={selected}
                onSelect={setSelected}
                onNodes={setNodes}
              />
              <TopologyAside node={node} live={live} load={load} onOpenGroup={onOpenGroup} />
            </div>
          </section>
        ) : null}
      </div>
    </SplitPage>
  );
}
