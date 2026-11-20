import { Bot, Hash, Plug, Server, type LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  telegram: Bot,
  slack: Hash,
  'service-registry': Server,
};

/** The icon of a kind; a kind the panel does not know gets the general one. */
export const kindIcon = (kind: string): LucideIcon => ICONS[kind] ?? Plug;
