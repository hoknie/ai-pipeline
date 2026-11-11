import {
  Activity,
  BarChart3,
  GitBranch,
  ListOrdered,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { TFunction } from 'i18next';

import type { View } from '../shared/lib/nav/route.ts';

export interface Section {
  view: View;
  labelKey: 'runs' | 'queue' | 'specialists' | 'pipelines' | 'stats' | 'settings';
  icon: LucideIcon;
}

/** Sections of the panel: navigation, palette and headings take labels from here. */
export const SECTIONS: Section[] = [
  { view: 'runs', labelKey: 'runs', icon: Activity },
  { view: 'queue', labelKey: 'queue', icon: ListOrdered },
  { view: 'specialists', labelKey: 'specialists', icon: Users },
  { view: 'pipelines', labelKey: 'pipelines', icon: GitBranch },
  { view: 'stats', labelKey: 'stats', icon: BarChart3 },
  { view: 'settings', labelKey: 'settings', icon: Settings },
];

export function sectionLabel(view: View, t: TFunction): string {
  const section = SECTIONS.find((candidate) => candidate.view === view);
  return section ? t(`nav.${section.labelKey}`) : view;
}
