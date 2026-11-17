import {
  Activity,
  BarChart3,
  GitBranch,
  ListOrdered,
  Server,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { TFunction } from 'i18next';

import type { View } from '../shared/lib/nav/route.ts';

export interface Section {
  view: View;
  labelKey: 'runs' | 'queue' | 'specialists' | 'pipelines' | 'providers' | 'stats' | 'settings';
  icon: LucideIcon;
  /** The letter of the `ctrl` shortcut that goes to the section. */
  key: 'r' | 'q' | 's' | 'b' | 'o' | 't' | 'c';
}

/** Sections of the panel: navigation, palette and headings take labels from here. */
export const SECTIONS: Section[] = [
  { view: 'runs', labelKey: 'runs', icon: Activity, key: 'r' },
  { view: 'queue', labelKey: 'queue', icon: ListOrdered, key: 'q' },
  { view: 'specialists', labelKey: 'specialists', icon: Users, key: 's' },
  // `ctrl+p` opens the project menu, so pipelines take the letter of their git-branch icon
  { view: 'pipelines', labelKey: 'pipelines', icon: GitBranch, key: 'b' },
  { view: 'providers', labelKey: 'providers', icon: Server, key: 'o' },
  { view: 'stats', labelKey: 'stats', icon: BarChart3, key: 't' },
  { view: 'settings', labelKey: 'settings', icon: Settings, key: 'c' },
];

export function sectionLabel(view: View, t: TFunction): string {
  const section = SECTIONS.find((candidate) => candidate.view === view);
  return section ? t(`nav.${section.labelKey}`) : view;
}
