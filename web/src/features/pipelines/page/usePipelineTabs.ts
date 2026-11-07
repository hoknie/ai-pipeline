import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import { SYSTEM_KINDS, isSystemKind } from '../../../shared/lib/pipeline/pipelineEntries.ts';
import { formatRoute, type PipelineSection } from '../../../shared/lib/nav/route.ts';
import { NEW_ID } from '../../specialists/index.ts';
import type { Level, PipelineNavigation } from './usePipelineNavigation.ts';

type Tab = 'pipelines' | 'actions' | 'system';

/** The tabs «pipelines», «actions» and «system»; each leads to the entry last open on it. */
export function usePipelineTabs(props: {
  view: ConfigEditorResponse | null;
  actions: { id: string }[];
  section: PipelineSection | null;
  selected: string | null;
  level: Level;
  navigation: PipelineNavigation;
}) {
  const { view, actions, section, selected, level, navigation } = props;
  const { t } = useTranslation();
  /** Where a tab leads: the entry last open on it, else the default one. */
  const targetOf = (tab: Tab): string | null => {
    const last = navigation.lastOpen.current[tab];
    if (tab === 'pipelines')
      return last !== undefined && view?.pipelines.some((entry) => entry.id === last) ? last : null;
    if (tab === 'system') return isSystemKind(last ?? null) ? (last as string) : SYSTEM_KINDS[0];
    return last !== undefined && actions.some((entry) => entry.id === last)
      ? last
      : (actions[0]?.id ?? NEW_ID);
  };
  return (['pipelines', 'actions', 'system'] as const).map((tab) => {
    const target = tab === 'actions' && !view ? null : targetOf(tab);
    const nextSection = tab === 'pipelines' ? null : tab;
    const isSelected = (section ?? 'pipelines') === tab;
    return {
      key: tab,
      label: t(`pipeline.sections.${tab}`),
      // the open tab keeps its own address, including the level of a system stage
      href: formatRoute({
        view: 'pipelines',
        run: isSelected ? selected : target,
        group: nextSection,
        step: isSelected && level !== null ? 'global' : null,
        tab: null,
      }),
      selected: isSelected,
      disabled: tab === 'actions' && !view,
      onClick: (event: { preventDefault: () => void }) => {
        event.preventDefault();
        if (!isSelected) void navigation.go(target, nextSection);
      },
    };
  });
}
