import { type ActionLookup, checkActions, checkStagePoints } from './validate-actions.ts';
import {
  type ValidateContext,
  addError,
  readChoice,
  readEntries,
  readInteger,
  readMapping,
  readString,
} from './validate-context.ts';
import { checkPipelines, checkSplitTargets } from './validate-pipelines.ts';
import { checkChains, checkRuntimes } from './validate-runtimes.ts';
import { checkVariantTargets } from './sections/variants.ts';
import {
  checkClaude,
  checkDefaults,
  checkDelivery,
  checkNaming,
  checkNetwork,
  checkWeb,
  checkWorkspace,
} from './validate-settings.ts';
import { checkMcpCatalog, resolveMcpServers } from './sections/mcp-servers.ts';
import { checkStats } from './sections/stats.ts';
import { checkSpecialist, checkSpecialists, SPECIALIST_KEYS } from './validate-specialists.ts';
import { type RuntimeChain } from '../types/chain.ts';
import { type FieldError } from '../types/errors.ts';
import { OBSERVER_SPECIALIST } from '../types/lookups.ts';
import { isMapping } from '../types/merge.ts';
import {
  DEFAULT_MAX,
  DEFAULT_WORKSPACE_DIR,
  defaultDelivery,
  defaultNaming,
  defaultNetwork,
  defaultRuntimes,
  defaultStats,
  defaultWeb,
  defaultWorkspace,
  MAX_RANGE,
  OUTSIDE_CHANGES,
  type NetworkSettings,
  type OutsideChanges,
  type ResolvedConfig,
  type RuntimeSettings,
  type WebSettings,
} from '../types/settings.ts';
import { defaultDefaults, type Specialist } from '../types/specialist.ts';

const ROOT_KEYS = ['swarm'];

const SWARM_KEYS = [
  'max',
  'workspace_dir',
  'workspace',
  'naming',
  'web',
  'runtimes',
  'network',
  'stats',
  'outside_changes',
  'claude',
  'delivery',
  'defaults',
  'mcp_servers',
  'specialists',
  'chains',
  'pipelines',
  'actions',
  'stages',
];

export type ValidationResult =
  { ok: true; config: ResolvedConfig } | { ok: false; errors: FieldError[] };

/** Checks the `web` section alone; `value` is the content of `swarm.web`, undefined when absent. */
export function validateWebSection(value: unknown): { web: WebSettings; errors: FieldError[] } {
  const ctx: ValidateContext = { errors: [] };
  const web = defaultWeb();
  if (value !== undefined) checkWeb(ctx, value, web);
  return { web, errors: ctx.errors };
}

/** Checks the `runtimes` section alone; `value` is the content of `swarm.runtimes`. */
export function validateRuntimesSection(value: unknown): {
  runtimes: RuntimeSettings;
  errors: FieldError[];
} {
  const ctx: ValidateContext = { errors: [] };
  const runtimes = defaultRuntimes();
  if (value !== undefined) checkRuntimes(ctx, value, runtimes);
  return { runtimes, errors: ctx.errors };
}

/** Checks the `network` section alone; `value` is the content of `swarm.network`. */
export function validateNetworkSection(value: unknown): {
  network: NetworkSettings;
  errors: FieldError[];
} {
  const ctx: ValidateContext = { errors: [] };
  const network = defaultNetwork();
  if (value !== undefined) checkNetwork(ctx, value, network);
  return { network, errors: ctx.errors };
}

export function validateConfig(root: unknown): ValidationResult {
  const ctx: ValidateContext = { errors: [] };
  const config = checkRoot(ctx, root);
  return ctx.errors.length === 0 ? { ok: true, config } : { ok: false, errors: ctx.errors };
}

/** Keys of the profile of the observer: a specialist that is never queued, limited or tagged. */
const OBSERVER_KEYS = SPECIALIST_KEYS.filter(
  (key) => !['max', 'queue', 'tags', 'mcp_servers'].includes(key),
);

const OBSERVER_DEFAULT_NAME = 'Observer';

export interface ObserverProfileResult {
  specialist: Specialist;
  errors: FieldError[];
}

/**
 * Checks the profile of the observer (settings of the panel, not `swarm.yaml`). Field paths
 * start with `specialist`. A profile without a name gets the name `Observer`.
 */
export function validateObserverProfile(value: unknown): ObserverProfileResult {
  const ctx: ValidateContext = { errors: [] };
  const input =
    isMapping(value) && !('name' in value) ? { ...value, name: OBSERVER_DEFAULT_NAME } : value;
  const specialist = checkSpecialist(
    ctx,
    OBSERVER_SPECIALIST,
    input,
    'specialist',
    defaultDefaults(),
    OBSERVER_KEYS,
  );
  const fallback: Specialist = {
    slug: OBSERVER_SPECIALIST,
    name: OBSERVER_DEFAULT_NAME,
    model: null,
    runtime: defaultDefaults().runtime,
    permissions: defaultDefaults().permissions,
    timeoutSeconds: defaultDefaults().timeoutSeconds,
    allowCommands: [],
    tools: [],
    skills: [],
    prompt: null,
    max: null,
    queue: false,
    level: 'project',
  };
  return { specialist: specialist ?? fallback, errors: ctx.errors };
}

export function checkRoot(ctx: ValidateContext, root: unknown): ResolvedConfig {
  const config: ResolvedConfig = {
    max: DEFAULT_MAX,
    workspaceDir: DEFAULT_WORKSPACE_DIR,
    workspace: defaultWorkspace(),
    naming: defaultNaming(),
    web: defaultWeb(),
    runtimes: defaultRuntimes(),
    outsideChanges: 'warn',
    claude: { editMode: 'allowlist', mcp: 'isolated', settings: 'isolated' },
    delivery: defaultDelivery(),
    defaults: defaultDefaults(),
    mcpServers: {},
    specialists: [],
    chains: [],
    pipelines: [],
    actions: [],
    stages: {},
  };
  if (!isMapping(root)) {
    addError(ctx, 'swarm', 'the file must contain a `swarm` mapping');
    return config;
  }
  readEntries(ctx, root, '', ROOT_KEYS);
  if (!('swarm' in root)) {
    addError(ctx, 'swarm', 'is required');
    return config;
  }
  const swarm = readMapping(ctx, root.swarm, 'swarm');
  if (!swarm) return config;
  readEntries(ctx, swarm, 'swarm', SWARM_KEYS);
  if ('max' in swarm)
    config.max = readInteger(ctx, swarm.max, 'swarm.max', MAX_RANGE) ?? config.max;
  if ('workspace_dir' in swarm) {
    config.workspaceDir =
      readString(ctx, swarm.workspace_dir, 'swarm.workspace_dir') ?? config.workspaceDir;
  }
  if ('workspace' in swarm)
    checkWorkspace(ctx, swarm.workspace, config.workspace, config.workspaceDir);
  if ('naming' in swarm) checkNaming(ctx, swarm.naming, config.naming);
  if ('web' in swarm) checkWeb(ctx, swarm.web, config.web);
  if ('runtimes' in swarm) checkRuntimes(ctx, swarm.runtimes, config.runtimes);
  if ('network' in swarm) checkNetwork(ctx, swarm.network, defaultNetwork());
  if ('stats' in swarm) checkStats(ctx, swarm.stats, defaultStats());
  if ('outside_changes' in swarm) {
    config.outsideChanges =
      readChoice<OutsideChanges>(
        ctx,
        swarm.outside_changes,
        'swarm.outside_changes',
        OUTSIDE_CHANGES,
      ) ?? config.outsideChanges;
  }
  if ('claude' in swarm) checkClaude(ctx, swarm.claude, config.claude);
  if ('delivery' in swarm) {
    const known = isMapping(swarm.specialists) ? Object.keys(swarm.specialists) : [];
    checkDelivery(ctx, swarm.delivery, config.delivery, known);
  }
  if ('defaults' in swarm) checkDefaults(ctx, swarm.defaults, config.defaults);
  if ('mcp_servers' in swarm) config.mcpServers = checkMcpCatalog(ctx, swarm.mcp_servers);
  if ('chains' in swarm) config.chains = checkChains(ctx, swarm.chains);
  if ('specialists' in swarm)
    config.specialists = checkSpecialists(ctx, swarm.specialists, config.defaults);
  resolveMcpServers(ctx, config.specialists, config.mcpServers);
  checkSpecialistChains(ctx, config.specialists, config.chains);
  const knownSpecialists = isMapping(swarm.specialists) ? Object.keys(swarm.specialists) : [];
  if ('actions' in swarm) config.actions = checkActions(ctx, swarm.actions, knownSpecialists);
  const knownActions = isMapping(swarm.actions) ? Object.keys(swarm.actions) : [];
  const actionPoints: ActionLookup = { known: knownActions, actions: config.actions };
  if ('stages' in swarm) {
    config.stages = checkStagePoints(ctx, swarm.stages, 'swarm.stages', actionPoints, null);
  }
  if ('pipelines' in swarm) {
    config.pipelines = checkPipelines(ctx, swarm.pipelines, knownSpecialists, actionPoints);
    checkSplitTargets(ctx, config.pipelines);
    checkVariantTargets(ctx, config);
  }
  return config;
}

function checkSpecialistChains(
  ctx: ValidateContext,
  specialists: Specialist[],
  chains: RuntimeChain[],
): void {
  const known = chains.map((chain) => chain.slug);
  for (const specialist of specialists) {
    if (!specialist.runtimeChain) continue;
    const path = `swarm.specialists.${specialist.slug}.runtime_chain`;
    const chain = chains.find((c) => c.slug === specialist.runtimeChain);
    if (!chain) {
      const hint = known.length > 0 ? `; known: ${known.join(', ')}` : '; none defined';
      addError(ctx, path, `unknown chain \`${specialist.runtimeChain}\`${hint}`);
    }
  }
}
