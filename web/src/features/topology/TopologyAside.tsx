import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { repositoryLabel } from '../../shared/lib/catalog/repositories.ts';
import type { MachineLoad } from '../../shared/lib/pipeline/specialistLoad.ts';
import { StatusBadge } from '../../shared/ui/feedback/StatusBadge.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import type { Live, LiveGroup } from './liveState.ts';
import { otherUse } from './topologyNodes.ts';
import type { StageNode } from './topologyTypes.ts';

/** A group (or a foreign attempt) as a link that opens it, with its status and a note. */
function GroupItem({
  title,
  status,
  onOpen,
  children,
}: {
  title: string;
  status: string;
  onOpen: () => void;
  children?: ReactNode;
}) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <Button
        variant="link"
        size="sm"
        className="h-auto max-w-full min-w-0 shrink p-0 text-left whitespace-normal"
        onClick={onOpen}
      >
        {title}
      </Button>
      <StatusBadge status={status} />
      {children}
    </li>
  );
}

/** What a stage that is not a step does, who performs it and when. */
function StageAbout({ node }: { node: StageNode }) {
  const { t } = useTranslation();
  const { data } = node;
  return (
    <div className="flex flex-col gap-1" data-testid="stage-about">
      <p>{t(`topology.stages.about.${data.kind}`)}</p>
      <p className="text-muted-foreground">
        {t('topology.stages.performer')}: {data.performer}
      </p>
      {data.condition !== null ? (
        <p className="text-muted-foreground">
          {t('topology.stages.conditionLabel')}: {data.condition}
        </p>
      ) : null}
      {data.link ? (
        <a className="text-primary underline-offset-4 hover:underline" href={data.link}>
          {t('topology.stages.open')}
        </a>
      ) : null}
    </div>
  );
}

function NodeDetails({
  node,
  onOpenGroup,
}: {
  node: StageNode;
  onOpenGroup: (group: LiveGroup, step: string | null) => void;
}) {
  const { t } = useTranslation();
  const { data } = node;
  return (
    <>
      <h3 className="font-semibold">{data.title}</h3>
      <p className="text-muted-foreground">{data.subtitle}</p>
      {data.kind !== 'step' ? <StageAbout node={node} /> : null}
      {data.groups.length === 0 ? (
        <p className="text-muted-foreground">{t('topology.noGroups')}</p>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {data.groups.map((group) => (
          <GroupItem
            key={`${group.runId}/${group.slug}`}
            title={group.title}
            status={group.status}
            onOpen={() => onOpenGroup(group, data.step)}
          >
            <span className="min-w-0 text-muted-foreground">{group.runTitle}</span>
          </GroupItem>
        ))}
      </ul>
    </>
  );
}

function Occupied({
  node,
  others,
  load,
  onOpenGroup,
}: {
  node: StageNode | null;
  others: ReturnType<typeof otherUse>;
  load: MachineLoad;
  onOpenGroup: (group: LiveGroup, step: string | null) => void;
}) {
  const { t } = useTranslation();
  const specialist = node?.data.specialist ?? '';
  return (
    <>
      <h3 className="font-semibold">{t('topology.occupied')}</h3>
      <p className="text-muted-foreground">
        {t('topology.occupiedHint', { specialist: load.get(specialist)?.name ?? specialist })}
      </p>
      <ul className="flex flex-col gap-1.5" aria-label={t('topology.occupied')}>
        {[...others.running, ...others.waiting].map((entry) => (
          <GroupItem
            key={`${entry.runId}/${entry.group}/${entry.status}`}
            title={entry.title}
            status={entry.status}
            onOpen={() =>
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
            <span className="min-w-0 text-muted-foreground">
              {entry.stepName} · {entry.runTitle} · {repositoryLabel(entry.repository)}
            </span>
          </GroupItem>
        ))}
      </ul>
    </>
  );
}

/** The panel next to the graph: the chosen node, who else uses its specialist, stray groups. */
export function TopologyAside({
  node,
  live,
  load,
  onOpenGroup,
}: {
  node: StageNode | null;
  live: Live;
  load: MachineLoad;
  onOpenGroup: (group: LiveGroup, step: string | null) => void;
}) {
  const { t } = useTranslation();
  const others = node?.data.specialist ? otherUse(load, live, node.data.specialist) : null;
  return (
    <aside
      className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 text-sm [overflow-wrap:anywhere]"
      aria-label={node ? t('topology.nodeNamed', { title: node.data.title }) : t('topology.node')}
    >
      {node ? (
        <NodeDetails node={node} onOpenGroup={onOpenGroup} />
      ) : (
        <p className="text-muted-foreground">{t('topology.selectNode')}</p>
      )}
      {others && (others.running.length > 0 || others.waiting.length > 0) ? (
        <Occupied node={node} others={others} load={load} onOpenGroup={onOpenGroup} />
      ) : null}
      {live.elsewhere.length > 0 ? (
        <>
          <h3 className="font-semibold">{t('topology.elsewhere')}</h3>
          <p className="text-muted-foreground">{t('topology.elsewhereHint')}</p>
          <ul className="flex flex-col gap-1.5">
            {live.elsewhere.map((group) => (
              <GroupItem
                key={`${group.runId}/${group.slug}`}
                title={group.title}
                status={group.status}
                onOpen={() => onOpenGroup(group, null)}
              />
            ))}
          </ul>
        </>
      ) : null}
    </aside>
  );
}
