import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import { formatRoute } from '../route.ts';
import type { RunView, WorkflowsView } from '../types.ts';

import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Skeleton } from '../ui/skeleton.tsx';

import { ConfigErrors, EntryList, SplitPage } from './EntryList.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { WorkflowGraph } from './WorkflowGraph.tsx';
import { repositoryLabel } from '../repositories.ts';
import { machineLoad } from '../specialistLoad.ts';
import { liveState, otherUse, type LiveGroup, type StageNode } from './topologyLayout.ts';

export default function TopologyPage({
  api,
  runs,
  workflow: selectedId,
  onSelectWorkflow,
  onEditWorkflow,
  onOpenGroup,
}: {
  api: Api;
  runs: RunView[];
  workflow: string | null;
  onSelectWorkflow: (id: string) => void;
  onEditWorkflow?: (id: string) => void;
  onOpenGroup: (group: LiveGroup, step: string | null) => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<WorkflowsView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    api.workflows().then(
      (next) => !stopped && setView(next),
      (error: Error) => !stopped && setFailure(error.message),
    );
    return () => {
      stopped = true;
    };
  }, [api]);

  const workflow =
    view?.workflows.find((candidate) => candidate.id === selectedId) ?? view?.workflows[0] ?? null;
  const counts = useMemo(
    () =>
      new Map(
        (view?.workflows ?? []).map((candidate) => [
          candidate.id,
          liveState(candidate, runs, view?.repository ?? null).runs,
        ]),
      ),
    [view, runs],
  );
  const live = useMemo(
    () => (workflow ? liveState(workflow, runs, view?.repository ?? null) : null),
    [workflow, runs, view],
  );
  const load = useMemo(() => machineLoad(runs), [runs]);
  const [nodes, setNodes] = useState<StageNode[]>([]);
  const node = nodes.find((candidate) => candidate.id === selected) ?? null;
  const others = node?.data.specialist && live ? otherUse(load, live, node.data.specialist) : null;

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
            selected={workflow?.id ?? null}
            onSelect={(id) => {
              setSelected(null);
              onSelectWorkflow(id);
            }}
            entries={(view?.workflows ?? []).map((candidate) => ({
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
            }))}
          />
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {failure ? <Alert variant="destructive">{failure}</Alert> : null}
        {view ? <ConfigErrors errors={view.errors} /> : null}
        {workflow && live ? (
          <section aria-label={`pipeline ${workflow.id}`} className="flex flex-col gap-3">
            <header className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold" title={workflow.id}>
                  {workflow.name}
                </h2>
                {onEditWorkflow ? (
                  <Button variant="link" size="sm" asChild>
                    <a
                      href={formatRoute({
                        view: 'workflows',
                        run: workflow.id,
                        group: null,
                        step: null,
                        tab: null,
                      })}
                      onClick={(event) => {
                        event.preventDefault();
                        onEditWorkflow(workflow.id);
                      }}
                    >
                      {t('topology.edit')}
                    </a>
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                <span>{view?.repository}</span>
                <span>{t('topology.delivery', { mode: workflow.delivery.mode })}</span>
                {live.runs > 0 ? (
                  <span>{t('topology.activeRuns', { n: live.runs })}</span>
                ) : (
                  <span>{t('topology.noActive')}</span>
                )}
              </div>
            </header>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <WorkflowGraph
                workflow={workflow}
                live={live}
                load={load}
                selected={selected}
                onSelect={setSelected}
                onNodes={setNodes}
              />
              <aside
                className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 text-sm [overflow-wrap:anywhere]"
                aria-label={
                  node ? t('topology.nodeNamed', { title: node.data.title }) : t('topology.node')
                }
              >
                {node ? (
                  <>
                    <h3 className="font-semibold">{node.data.title}</h3>
                    <p className="text-muted-foreground">{node.data.subtitle}</p>
                    {node.data.groups.length === 0 ? (
                      <p className="text-muted-foreground">{t('topology.noGroups')}</p>
                    ) : null}
                    <ul className="flex flex-col gap-1.5">
                      {node.data.groups.map((group) => (
                        <li
                          key={`${group.runId}/${group.slug}`}
                          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
                        >
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto max-w-full min-w-0 shrink p-0 text-left whitespace-normal"
                            onClick={() => onOpenGroup(group, node.data.step)}
                          >
                            {group.title}
                          </Button>
                          <StatusBadge status={group.status} />
                          <span className="min-w-0 text-muted-foreground">{group.runTitle}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-muted-foreground">{t('topology.selectNode')}</p>
                )}
                {others && (others.running.length > 0 || others.waiting.length > 0) ? (
                  <>
                    <h3 className="font-semibold">{t('topology.occupied')}</h3>
                    <p className="text-muted-foreground">
                      {t('topology.occupiedHint', {
                        specialist:
                          load.get(node?.data.specialist ?? '')?.name ??
                          node?.data.specialist ??
                          '',
                      })}
                    </p>
                    <ul className="flex flex-col gap-1.5" aria-label={t('topology.occupied')}>
                      {[...others.running, ...others.waiting].map((entry) => (
                        <li
                          key={`${entry.runId}/${entry.group}/${entry.status}`}
                          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
                        >
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto max-w-full min-w-0 shrink p-0 text-left whitespace-normal"
                            onClick={() =>
                              onOpenGroup(
                                {
                                  runId: entry.runId,
                                  runTitle: entry.runTitle,
                                  slug: entry.group,
                                  title: entry.title,
                                  status: entry.status,
                                },
                                entry.step,
                              )
                            }
                          >
                            {entry.title}
                          </Button>
                          <StatusBadge status={entry.status} />
                          <span className="min-w-0 text-muted-foreground">
                            {entry.stepName} · {entry.runTitle} ·{' '}
                            {repositoryLabel(entry.repository)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {live.elsewhere.length > 0 ? (
                  <>
                    <h3 className="font-semibold">{t('topology.elsewhere')}</h3>
                    <p className="text-muted-foreground">{t('topology.elsewhereHint')}</p>
                    <ul className="flex flex-col gap-1.5">
                      {live.elsewhere.map((group) => (
                        <li
                          key={`${group.runId}/${group.slug}`}
                          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
                        >
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto max-w-full min-w-0 shrink p-0 text-left whitespace-normal"
                            onClick={() => onOpenGroup(group, null)}
                          >
                            {group.title}
                          </Button>
                          <StatusBadge status={group.status} />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </aside>
            </div>
          </section>
        ) : null}
      </div>
    </SplitPage>
  );
}
