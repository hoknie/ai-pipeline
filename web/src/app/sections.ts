import { Activity, BarChart3, Boxes, ListOrdered, Settings, type LucideIcon } from 'lucide-react';

import type { TFunction } from 'i18next';

import type { Route, View } from '../shared/lib/nav/route.ts';

export interface Section {
  /** The view a click on the section opens (the section «Swarm» opens its last tab). */
  view: View;
  /** Every view the section shows; the section is highlighted for any of them. */
  views: View[];
  labelKey: 'runs' | 'queue' | 'swarm' | 'stats' | 'settings';
  icon: LucideIcon;
}

/** The views of the section «Swarm»: tabs of one window. */
export const SWARM_VIEWS: View[] = ['providers', 'specialists', 'pipelines'];

/** Sections of the panel: navigation, palette and headings take labels from here. */
export const SECTIONS: Section[] = [
  { view: 'runs', views: ['runs'], labelKey: 'runs', icon: Activity },
  { view: 'queue', views: ['queue'], labelKey: 'queue', icon: ListOrdered },
  { view: 'specialists', views: SWARM_VIEWS, labelKey: 'swarm', icon: Boxes },
  { view: 'stats', views: ['stats'], labelKey: 'stats', icon: BarChart3 },
  { view: 'settings', views: ['settings'], labelKey: 'settings', icon: Settings },
];

/** Whether a section shows a view. */
export const showsView = (section: Section, view: View): boolean => section.views.includes(view);

/** A `ctrl` shortcut that goes to a view; the tabs of the swarm have their own letters. */
export interface SectionShortcut {
  key: 'r' | 'q' | 's' | 'b' | 'o' | 't' | 'i' | 'c';
  view: View;
  /** Where the shortcut goes when that is not the plain page of `view` (a group of the settings). */
  route?: Route;
  /** The label in `nav.*`. */
  labelKey:
    | 'runs'
    | 'queue'
    | 'specialists'
    | 'pipelines'
    | 'providers'
    | 'stats'
    | 'integrations'
    | 'settings';
}

export const SECTION_SHORTCUTS: SectionShortcut[] = [
  { key: 'r', view: 'runs', labelKey: 'runs' },
  { key: 'q', view: 'queue', labelKey: 'queue' },
  { key: 's', view: 'specialists', labelKey: 'specialists' },
  // `ctrl+p` opens the project menu, so pipelines take the letter of their git-branch icon
  { key: 'b', view: 'pipelines', labelKey: 'pipelines' },
  { key: 'o', view: 'providers', labelKey: 'providers' },
  { key: 't', view: 'stats', labelKey: 'stats' },
  // the integrations are a group of the shared settings, not a section of the navigation
  {
    key: 'i',
    view: 'settings',
    route: { view: 'settings', run: 'integrations', group: 'global', step: null, tab: null },
    labelKey: 'integrations',
  },
  { key: 'c', view: 'settings', labelKey: 'settings' },
];

export function sectionLabel(view: View, t: TFunction): string {
  const section = SECTIONS.find((candidate) => showsView(candidate, view));
  return section ? t(`nav.${section.labelKey}`) : view;
}
