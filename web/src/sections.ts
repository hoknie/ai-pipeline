import {
  Activity,
  GitBranch,
  ListOrdered,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

import type { TFunction } from 'i18next';

import type { View } from './route.ts';

export interface Section {
  view: View;
  labelKey: 'runs' | 'queue' | 'topology' | 'specialists' | 'workflows' | 'settings';
  icon: LucideIcon;
}

/** Sections of the panel: navigation, palette and headings take labels from here. */
export const SECTIONS: Section[] = [
  { view: 'runs', labelKey: 'runs', icon: Activity },
  { view: 'queue', labelKey: 'queue', icon: ListOrdered },
  { view: 'topology', labelKey: 'topology', icon: Workflow },
  { view: 'specialists', labelKey: 'specialists', icon: Users },
  { view: 'workflows', labelKey: 'workflows', icon: GitBranch },
  { view: 'settings', labelKey: 'settings', icon: Settings },
];

export function sectionLabel(view: View, t: TFunction): string {
  const section = SECTIONS.find((candidate) => candidate.view === view);
  return section ? t(`nav.${section.labelKey}`) : view;
}
