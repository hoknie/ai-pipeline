/** How a link of a project came to be. */
export type LinkSource = 'auto' | 'manual';

/**
 * What the last matching of a pair ended with. `linked` is a link; `disabled` is a pair the owner
 * cleared (no automatic matching until it is asked for); the rest say why there is no link.
 */
export const LINK_STATUSES = [
  'linked',
  'no_match',
  'ambiguous',
  'unreachable',
  'unauthorized',
  'truncated',
  'disabled',
] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

/** The link of a project of aip to a project of a registry, or the reason there is none. */
export interface ProjectLink {
  /** The root of the project of aip. */
  project: string;
  connectionId: string;
  /** The path of the project in the registry; null without a link. */
  registryPath: string | null;
  source: LinkSource | null;
  status: LinkStatus;
  /** The paths of the projects that match equally well (`ambiguous`); empty otherwise. */
  candidates: string[];
  matchedAt: number;
}

/** The automatic matching of a pair with no link is not repeated sooner than this. */
export const AUTO_LINK_INTERVAL_MS = 60 * 60 * 1000;
/** The pages of `list_projects` one matching reads at most. */
export const LIST_PAGES_LIMIT = 25;
/** The projects asked for in one page of `list_projects`. */
export const PROJECT_LIST_PAGE_SIZE = 200;
/** The longest path of a project of a registry the daemon accepts. */
export const REGISTRY_PATH_LIMIT = 512;

/** The page of the web interface of a registry that shows the project; `base` has no trailing slash. */
export function registryProjectUrl(base: string, path: string): string {
  return `${base}/catalog?node=${encodeURIComponent(path)}`;
}
