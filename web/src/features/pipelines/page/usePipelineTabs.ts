import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import { SYSTEM_KINDS, isSystemKind } from '../../../shared/lib/pipeline/pipelineEntries.ts';
import { rowKey, splitRowKey, type ProjectRef } from '../../../shared/lib/catalog/projectRows.ts';
import { formatRoute, type PipelineSection } from '../../../shared/lib/nav/route.ts';
import { NEW_ID } from '../../specialists/index.ts';
import type { PipelineNavigation } from './usePipelineNavigation.ts';

type Tab = 'pipelines' | 'actions' | 'system' | 'topology';

/** The pipeline the tab «topology» opens: the one last open on it, else the one open on «pipelines». */
function topologyTarget(
  view: ConfigEditorResponse | null,
  last: Record<Tab, string | undefined>,
  section: PipelineSection | null,
  selected: string | null,
): string | null {
  const ids = view?.pipelines.map((entry) => entry.id) ?? [];
  const known = (id: string | null | undefined): id is string => !!id && ids.includes(id);
  if (known(last.topology)) return last.topology;
  if (section === null && known(selected)) return selected;
  return known(last.pipelines) ? last.pipelines : (ids[0] ?? null);
}

/** The route of an entry key (`<project>/<id>` in the mode «All projects»). */
function routeOf(key: string | null, group: PipelineSection | null) {
  const { project, id } = key === null ? { project: null, id: null } : splitRowKey(key);
  return {
    view: 'pipelines' as const,
    run: id,
    group,
    step: null,
    tab: null,
    ...(project === null ? {} : { project }),
  };
}

/** The tabs «pipelines», «actions», «system» and «topology»; each leads to the entry last open on it. */
export function usePipelineTabs(props: {
  view: ConfigEditorResponse | null;
  actions: { id: string }[];
  section: PipelineSection | null;
  selected: string | null;
  navigation: PipelineNavigation;
}) {
  const { view, actions, section, selected, navigation } = props;
  const { t } = useTranslation();
  const keyed = (entries: readonly { id: string; project?: ProjectRef | null }[]) =>
    entries.map((entry) => rowKey(entry.project?.slug, entry.id));
  /** Where a tab leads: the entry last open on it, else the default one. */
  const targetOf = (tab: Tab): string | null => {
    const last = navigation.lastOpen.current[tab];
    if (tab === 'pipelines')
      return last !== undefined && keyed(view?.pipelines ?? []).includes(last) ? last : null;
    if (tab === 'topology')
      return topologyTarget(view, navigation.lastOpen.current, section, selected);
    if (tab === 'system') return isSystemKind(last ?? null) ? (last as string) : SYSTEM_KINDS[0];
    return last !== undefined && keyed(actions).includes(last)
      ? last
      : (keyed(actions)[0] ?? NEW_ID);
  };
  return (['pipelines', 'actions', 'system', 'topology'] as const).map((tab) => {
    const target = tab === 'actions' && !view ? null : targetOf(tab);
    const nextSection = tab === 'pipelines' ? null : tab;
    const isSelected = (section ?? 'pipelines') === tab;
    return {
      key: tab,
      label: t(`pipeline.sections.${tab}`),
      // the open tab keeps its own address
      href: formatRoute(routeOf(isSelected ? selected : target, nextSection)),
      selected: isSelected,
      disabled: (tab === 'actions' && !view) || (tab === 'topology' && target === null),
      onClick: (event: { preventDefault: () => void }) => {
        event.preventDefault();
        if (!isSelected) void navigation.go(target, nextSection);
      },
    };
  });
}
