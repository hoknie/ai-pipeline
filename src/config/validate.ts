import { parseDuration } from './duration.ts';
import type { FieldError } from './errors.ts';
import { isMapping } from './merge.ts';
import {
  CLAUDE_EDIT_MODES,
  CLAUDE_MCP_MODES,
  CLAUDE_SETTINGS_SOURCES,
  DELIVERY_MODES,
  defaultDelivery,
  defaultNaming,
  defaultWeb,
  WEB_AUTH_MODES,
  WEB_HOSTS,
  type WebAuth,
  type WebHost,
  type WebSettings,
  defaultWorkspace,
  WORKSPACE_BASES,
  DEFAULT_MAX,
  DEFAULT_MAX_GROUPS,
  DEFAULT_WORKSPACE_DIR,
  MAX_GROUPS_RANGE,
  OUTSIDE_CHANGES,
  MAX_RANGE,
  MAX_ROUNDS_RANGE,
  PERMISSIONS,
  RUNTIMES,
  SLUG_PATTERN_TEXT,
  defaultDefaults,
  isValidSlug,
  type ClaudeEditMode,
  type ClaudeMcpMode,
  type ClaudeSettingsSource,
  type DeliveryMode,
  type DeliverySettings,
  type NamingSettings,
  type WorkspaceBase,
  type WorkspaceSettings,
  type Defaults,
  type OutsideChanges,
  type Split,
  type OnReject,
  type Permissions,
  type ResolvedConfig,
  type Runtime,
  type Specialist,
  type Step,
  type Workflow,
} from './model.ts';

const ROOT_KEYS = ['swarm'];
const SWARM_KEYS = [
  'max',
  'workspace_dir',
  'workspace',
  'naming',
  'web',
  'outside_changes',
  'claude',
  'delivery',
  'defaults',
  'specialists',
  'workflows',
];
const CLAUDE_KEYS = ['edit_mode', 'mcp', 'settings'];
const DELIVERY_KEYS = [
  'mode',
  'auto',
  'keep',
  'commit_message',
  'message_specialist',
  'resolver',
  'resolver_rounds',
];
const WORKSPACE_KEYS = ['base', 'include'];
const WEB_KEYS = ['autostart', 'auth', 'port', 'host'];
const WEB_PORT_RANGE: Range = [1, 65535];
const NAMING_KEYS = ['enabled', 'runtime', 'model'];
const RESOLVER_ROUNDS_RANGE: Range = [1, 10];
const SPLIT_KEYS = ['specialist', 'max_groups', 'additional_prompt', 'workflow'];
const DEFAULTS_KEYS = ['runtime', 'permissions', 'timeout', 'allow_commands', 'tools'];
const SPECIALIST_KEYS = [
  'name',
  'model',
  'runtime',
  'permissions',
  'timeout',
  'allow_commands',
  'tools',
  'skills',
  'prompt',
  'max',
  'queue',
];
const WORKFLOW_KEYS = ['split', 'steps'];
const STEP_KEYS = ['id', 'specialist', 'on_reject', 'additional_prompt'];
const ON_REJECT_KEYS = ['goto', 'max_rounds'];

type Mapping = Record<string, unknown>;
type Range = readonly [number, number];

export type ValidationResult =
  { ok: true; config: ResolvedConfig } | { ok: false; errors: FieldError[] };

/** Checks the `web` section alone; `value` is the content of `swarm.web`, undefined when absent. */
export function validateWebSection(value: unknown): { web: WebSettings; errors: FieldError[] } {
  const validator = new Validator();
  const web = defaultWeb();
  if (value !== undefined) validator.web(value, web);
  return { web, errors: validator.errors };
}

export function validateConfig(root: unknown): ValidationResult {
  const validator = new Validator();
  const config = validator.root(root);
  return validator.errors.length === 0
    ? { ok: true, config }
    : { ok: false, errors: validator.errors };
}

function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

class Validator {
  readonly errors: FieldError[] = [];

  error(path: string, message: string): void {
    this.errors.push({ path, message });
  }

  mapping(value: unknown, path: string): Mapping | null {
    if (isMapping(value)) return value;
    this.error(path, 'must be a mapping');
    return null;
  }

  entries(mapping: Mapping, path: string, allowed: string[] | null): [string, unknown][] {
    return Object.entries(mapping).filter(([key]) => {
      if (allowed === null || allowed.includes(key)) return true;
      this.error(join(path, key), 'unknown key');
      return false;
    });
  }

  string(value: unknown, path: string): string | null {
    if (typeof value !== 'string') {
      this.error(path, 'must be a string');
      return null;
    }
    if (value.trim() === '') {
      this.error(path, 'must not be empty');
      return null;
    }
    return value;
  }

  strings(value: unknown, path: string): string[] {
    if (!Array.isArray(value)) {
      this.error(path, 'must be a list of strings');
      return [];
    }
    return value.flatMap((item, index) => this.string(item, `${path}[${index}]`) ?? []);
  }

  integer(value: unknown, path: string, [low, high]: Range): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high) {
      return value;
    }
    this.error(path, `must be an integer from ${low} to ${high}`);
    return null;
  }

  choice<T extends string>(value: unknown, path: string, options: readonly T[]): T | null {
    const text = this.string(value, path);
    if (text === null) return null;
    if ((options as readonly string[]).includes(text)) return text as T;
    this.error(path, `must be one of ${options.join(', ')}`);
    return null;
  }

  timeout(value: unknown, path: string): number | null {
    const text = this.string(value, path);
    if (text === null) return null;
    const seconds = parseDuration(text);
    if (seconds === null) this.error(path, 'must be a positive duration such as 90s, 30m or 2h');
    return seconds;
  }

  root(root: unknown): ResolvedConfig {
    const config: ResolvedConfig = {
      max: DEFAULT_MAX,
      workspaceDir: DEFAULT_WORKSPACE_DIR,
      workspace: defaultWorkspace(),
      naming: defaultNaming(),
      web: defaultWeb(),
      outsideChanges: 'warn',
      claude: { editMode: 'allowlist', mcp: 'isolated', settings: 'isolated' },
      delivery: defaultDelivery(),
      defaults: defaultDefaults(),
      specialists: [],
      workflows: [],
    };
    if (!isMapping(root)) {
      this.error('swarm', 'the file must contain a `swarm` mapping');
      return config;
    }
    this.entries(root, '', ROOT_KEYS);
    if (!('swarm' in root)) {
      this.error('swarm', 'is required');
      return config;
    }
    const swarm = this.mapping(root.swarm, 'swarm');
    if (!swarm) return config;
    this.entries(swarm, 'swarm', SWARM_KEYS);
    if ('max' in swarm) config.max = this.integer(swarm.max, 'swarm.max', MAX_RANGE) ?? config.max;
    if ('workspace_dir' in swarm) {
      config.workspaceDir =
        this.string(swarm.workspace_dir, 'swarm.workspace_dir') ?? config.workspaceDir;
    }
    if ('workspace' in swarm)
      this.workspace(swarm.workspace, config.workspace, config.workspaceDir);
    if ('naming' in swarm) this.naming(swarm.naming, config.naming);
    if ('web' in swarm) this.web(swarm.web, config.web);
    if ('outside_changes' in swarm) {
      config.outsideChanges =
        this.choice<OutsideChanges>(
          swarm.outside_changes,
          'swarm.outside_changes',
          OUTSIDE_CHANGES,
        ) ?? config.outsideChanges;
    }
    if ('claude' in swarm) {
      const claude = this.mapping(swarm.claude, 'swarm.claude');
      if (claude) {
        this.entries(claude, 'swarm.claude', CLAUDE_KEYS);
        if ('edit_mode' in claude) {
          config.claude.editMode =
            this.choice<ClaudeEditMode>(
              claude.edit_mode,
              'swarm.claude.edit_mode',
              CLAUDE_EDIT_MODES,
            ) ?? config.claude.editMode;
        }
        if ('mcp' in claude) {
          config.claude.mcp =
            this.choice<ClaudeMcpMode>(claude.mcp, 'swarm.claude.mcp', CLAUDE_MCP_MODES) ??
            config.claude.mcp;
        }
        if ('settings' in claude) {
          config.claude.settings =
            this.choice<ClaudeSettingsSource>(
              claude.settings,
              'swarm.claude.settings',
              CLAUDE_SETTINGS_SOURCES,
            ) ?? config.claude.settings;
        }
      }
    }
    if ('delivery' in swarm) {
      const known = isMapping(swarm.specialists) ? Object.keys(swarm.specialists) : [];
      this.delivery(swarm.delivery, config.delivery, known);
    }
    if ('defaults' in swarm) this.defaults(swarm.defaults, config.defaults);
    if ('specialists' in swarm)
      config.specialists = this.specialists(swarm.specialists, config.defaults);
    if ('workflows' in swarm) {
      const known = isMapping(swarm.specialists) ? Object.keys(swarm.specialists) : [];
      config.workflows = this.workflows(swarm.workflows, known);
      this.splitTargets(config.workflows);
    }
    return config;
  }

  splitTargets(workflows: Workflow[]): void {
    for (const workflow of workflows) {
      const target = workflow.split?.workflow;
      if (!target) continue;
      const path = `swarm.workflows.${workflow.id}.split.workflow`;
      const found = workflows.find((other) => other.id === target);
      if (!found) {
        this.error(
          path,
          `unknown workflow \`${target}\`; known: ${workflows.map((other) => other.id).join(', ')}`,
        );
      } else if (found.id === workflow.id) {
        this.error(path, 'must not point to the workflow itself');
      } else if (found.split?.workflow) {
        this.error(
          path,
          `workflow \`${target}\` has its own \`split.workflow\`; chains are not allowed`,
        );
      }
    }
  }

  boolean(value: unknown, path: string): boolean | null {
    if (typeof value === 'boolean') return value;
    this.error(path, 'must be true or false');
    return null;
  }

  delivery(value: unknown, delivery: DeliverySettings, known: string[]): void {
    const mapping = this.mapping(value, 'swarm.delivery');
    if (!mapping) return;
    for (const [key, field] of this.entries(mapping, 'swarm.delivery', DELIVERY_KEYS)) {
      const path = join('swarm.delivery', key);
      if (key === 'mode') {
        delivery.mode = this.choice<DeliveryMode>(field, path, DELIVERY_MODES) ?? delivery.mode;
      }
      if (key === 'auto') delivery.auto = this.boolean(field, path) ?? delivery.auto;
      if (key === 'keep') delivery.keep = this.boolean(field, path) ?? delivery.keep;
      if (key === 'commit_message') {
        delivery.commitMessage = this.string(field, path) ?? delivery.commitMessage;
      }
      if (key === 'message_specialist') delivery.messageSpecialist = this.known(field, path, known);
      if (key === 'resolver') delivery.resolver = this.known(field, path, known);
      if (key === 'resolver_rounds') {
        delivery.resolverRounds =
          this.integer(field, path, RESOLVER_ROUNDS_RANGE) ?? delivery.resolverRounds;
      }
    }
  }

  known(value: unknown, path: string, known: string[]): string | null {
    const slug = this.string(value, path);
    if (slug !== null && !known.includes(slug)) {
      this.error(path, `unknown specialist \`${slug}\`; known: ${known.join(', ')}`);
    }
    return slug;
  }

  web(value: unknown, web: WebSettings): void {
    const mapping = this.mapping(value, 'swarm.web');
    if (!mapping) return;
    for (const [key, field] of this.entries(mapping, 'swarm.web', WEB_KEYS)) {
      const path = join('swarm.web', key);
      if (key === 'autostart') web.autostart = this.boolean(field, path) ?? web.autostart;
      if (key === 'auth') web.auth = this.choice<WebAuth>(field, path, WEB_AUTH_MODES) ?? web.auth;
      if (key === 'port') web.port = this.integer(field, path, WEB_PORT_RANGE) ?? web.port;
      if (key === 'host') web.host = this.choice<WebHost>(field, path, WEB_HOSTS) ?? web.host;
    }
  }

  naming(value: unknown, naming: NamingSettings): void {
    const mapping = this.mapping(value, 'swarm.naming');
    if (!mapping) return;
    for (const [key, field] of this.entries(mapping, 'swarm.naming', NAMING_KEYS)) {
      const path = join('swarm.naming', key);
      if (key === 'enabled') naming.enabled = this.boolean(field, path) ?? naming.enabled;
      if (key === 'runtime')
        naming.runtime = this.choice<Runtime>(field, path, RUNTIMES) ?? naming.runtime;
      if (key === 'model') naming.model = this.string(field, path) ?? naming.model;
    }
  }

  workspace(value: unknown, workspace: WorkspaceSettings, workspaceDir: string): void {
    const mapping = this.mapping(value, 'swarm.workspace');
    if (!mapping) return;
    for (const [key, field] of this.entries(mapping, 'swarm.workspace', WORKSPACE_KEYS)) {
      const path = join('swarm.workspace', key);
      if (key === 'base') {
        workspace.base = this.choice<WorkspaceBase>(field, path, WORKSPACE_BASES) ?? workspace.base;
      }
      if (key === 'include') {
        const paths = this.strings(field, path);
        paths.forEach((entry, index) => {
          const problem = includeProblem(entry, workspaceDir);
          if (problem) this.error(`${path}[${index}]`, problem);
        });
        workspace.include = paths;
      }
    }
  }

  defaults(value: unknown, defaults: Defaults): void {
    const mapping = this.mapping(value, 'swarm.defaults');
    if (!mapping) return;
    for (const [key, field] of this.entries(mapping, 'swarm.defaults', DEFAULTS_KEYS)) {
      const path = join('swarm.defaults', key);
      if (key === 'runtime')
        defaults.runtime = this.choice<Runtime>(field, path, RUNTIMES) ?? defaults.runtime;
      if (key === 'permissions')
        defaults.permissions =
          this.choice<Permissions>(field, path, PERMISSIONS) ?? defaults.permissions;
      if (key === 'timeout')
        defaults.timeoutSeconds = this.timeout(field, path) ?? defaults.timeoutSeconds;
      if (key === 'allow_commands') defaults.allowCommands = this.strings(field, path);
      if (key === 'tools') defaults.tools = this.strings(field, path);
    }
  }

  specialists(value: unknown, defaults: Defaults): Specialist[] {
    const mapping = this.mapping(value, 'swarm.specialists');
    if (!mapping) return [];
    return this.entries(mapping, 'swarm.specialists', null).flatMap(([slug, field]) => {
      const path = join('swarm.specialists', slug);
      if (!isValidSlug(slug)) this.error(path, `slug must match ${SLUG_PATTERN_TEXT}`);
      const specialist = this.specialist(slug, field, path, defaults);
      return specialist ? [specialist] : [];
    });
  }

  specialist(slug: string, value: unknown, path: string, defaults: Defaults): Specialist | null {
    const mapping = this.mapping(value, path);
    if (!mapping) return null;
    const specialist: Specialist = {
      slug,
      name: '',
      model: null,
      runtime: defaults.runtime,
      permissions: defaults.permissions,
      timeoutSeconds: defaults.timeoutSeconds,
      allowCommands: [...defaults.allowCommands],
      tools: [...defaults.tools],
      skills: [],
      prompt: null,
      max: null,
      queue: false,
    };
    for (const [key, field] of this.entries(mapping, path, SPECIALIST_KEYS)) {
      const fieldPath = join(path, key);
      switch (key) {
        case 'name':
          specialist.name = this.string(field, fieldPath) ?? '';
          break;
        case 'model':
          specialist.model = this.string(field, fieldPath);
          break;
        case 'runtime':
          specialist.runtime =
            this.choice<Runtime>(field, fieldPath, RUNTIMES) ?? specialist.runtime;
          break;
        case 'permissions':
          specialist.permissions =
            this.choice<Permissions>(field, fieldPath, PERMISSIONS) ?? specialist.permissions;
          break;
        case 'timeout':
          specialist.timeoutSeconds = this.timeout(field, fieldPath) ?? specialist.timeoutSeconds;
          break;
        case 'allow_commands':
          specialist.allowCommands = this.strings(field, fieldPath);
          break;
        case 'tools':
          specialist.tools = this.strings(field, fieldPath);
          break;
        case 'skills':
          specialist.skills = this.strings(field, fieldPath);
          break;
        case 'prompt':
          specialist.prompt = this.string(field, fieldPath);
          break;
        case 'max':
          specialist.max = this.integer(field, fieldPath, MAX_RANGE);
          break;
        case 'queue':
          specialist.queue = this.boolean(field, fieldPath) ?? false;
          break;
      }
    }
    if (!('name' in mapping)) this.error(join(path, 'name'), 'is required');
    return specialist;
  }

  workflows(value: unknown, known: string[]): Workflow[] {
    const mapping = this.mapping(value, 'swarm.workflows');
    if (!mapping) return [];
    return this.entries(mapping, 'swarm.workflows', null).flatMap(([id, field]) => {
      const path = join('swarm.workflows', id);
      if (!isValidSlug(id)) this.error(path, `id must match ${SLUG_PATTERN_TEXT}`);
      const workflow = this.workflow(id, field, path, known);
      return workflow ? [workflow] : [];
    });
  }

  workflow(id: string, value: unknown, path: string, known: string[]): Workflow | null {
    const mapping = this.mapping(value, path);
    if (!mapping) return null;
    this.entries(mapping, path, WORKFLOW_KEYS);
    const split = 'split' in mapping ? this.split(mapping.split, join(path, 'split'), known) : null;
    const stepsPath = join(path, 'steps');
    if (split?.workflow) {
      if ('steps' in mapping) {
        this.error(stepsPath, 'must not be set together with `split.workflow`');
        return null;
      }
      return { id, split, steps: [] };
    }
    if (!('steps' in mapping)) {
      this.error(stepsPath, 'is required');
      return null;
    }
    if (!Array.isArray(mapping.steps)) {
      this.error(stepsPath, 'must be a list of steps');
      return null;
    }
    if (mapping.steps.length === 0) {
      this.error(stepsPath, 'must not be empty');
      return null;
    }
    const steps = mapping.steps.map((item, index) =>
      this.step(item, `${stepsPath}[${index}]`, known),
    );
    steps.forEach((step, index) => {
      const stepPath = `${stepsPath}[${index}]`;
      if (step.id !== '' && steps.findIndex((other) => other.id === step.id) < index) {
        this.error(join(stepPath, 'id'), `duplicate step id \`${step.id}\``);
      }
      if (!step.onReject) return;
      const gotoPath = join(join(stepPath, 'on_reject'), 'goto');
      const target = steps.findIndex((other) => other.id === step.onReject?.goto);
      if (target === -1) this.error(gotoPath, `unknown step \`${step.onReject.goto}\``);
      else if (target >= index) this.error(gotoPath, 'must point to an earlier step');
    });
    return { id, split, steps };
  }

  split(value: unknown, path: string, known: string[]): Split | null {
    const mapping = this.mapping(value, path);
    if (!mapping) return null;
    this.entries(mapping, path, SPLIT_KEYS);
    const specialistPath = join(path, 'specialist');
    if (!('specialist' in mapping)) {
      this.error(specialistPath, 'is required');
      return null;
    }
    const specialist = this.string(mapping.specialist, specialistPath);
    if (specialist !== null && !known.includes(specialist)) {
      this.error(
        specialistPath,
        `unknown specialist \`${specialist}\`; known: ${known.join(', ')}`,
      );
    }
    const maxGroups =
      'max_groups' in mapping
        ? this.integer(mapping.max_groups, join(path, 'max_groups'), MAX_GROUPS_RANGE)
        : DEFAULT_MAX_GROUPS;
    const additionalPrompt =
      'additional_prompt' in mapping
        ? this.string(mapping.additional_prompt, join(path, 'additional_prompt'))
        : null;
    const workflow =
      'workflow' in mapping ? this.string(mapping.workflow, join(path, 'workflow')) : null;
    return specialist !== null && maxGroups !== null
      ? { specialist, maxGroups, additionalPrompt, workflow }
      : null;
  }

  step(value: unknown, path: string, known: string[]): Step {
    const step: Step = { id: '', specialist: '', onReject: null, additionalPrompt: null };
    const mapping = this.mapping(value, path);
    if (!mapping) return step;
    for (const [key, field] of this.entries(mapping, path, STEP_KEYS)) {
      const fieldPath = join(path, key);
      if (key === 'id') step.id = this.string(field, fieldPath) ?? '';
      if (key === 'specialist') {
        const slug = this.string(field, fieldPath);
        if (slug !== null && !known.includes(slug)) {
          this.error(fieldPath, `unknown specialist \`${slug}\`; known: ${known.join(', ')}`);
        }
        step.specialist = slug ?? '';
      }
      if (key === 'on_reject') step.onReject = this.onReject(field, fieldPath);
      if (key === 'additional_prompt') step.additionalPrompt = this.string(field, fieldPath);
    }
    if (!('id' in mapping)) this.error(join(path, 'id'), 'is required');
    if (!('specialist' in mapping)) this.error(join(path, 'specialist'), 'is required');
    return step;
  }

  onReject(value: unknown, path: string): OnReject | null {
    const mapping = this.mapping(value, path);
    if (!mapping) return null;
    this.entries(mapping, path, ON_REJECT_KEYS);
    const goto = 'goto' in mapping ? this.string(mapping.goto, join(path, 'goto')) : null;
    const maxRounds =
      'max_rounds' in mapping
        ? this.integer(mapping.max_rounds, join(path, 'max_rounds'), MAX_ROUNDS_RANGE)
        : null;
    if (!('goto' in mapping)) this.error(join(path, 'goto'), 'is required');
    if (!('max_rounds' in mapping)) this.error(join(path, 'max_rounds'), 'is required');
    return goto !== null && maxRounds !== null ? { goto, maxRounds } : null;
  }
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .replace(/^(\.\/)+/, '');
}

function includeProblem(entry: string, workspaceDir: string): string | null {
  const path = normalizePath(entry);
  if (path === '' || path === '.') return 'must name a path inside the repository, not the root';
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split('/').includes('..')) {
    return 'must be a path inside the repository';
  }
  const workspace = normalizePath(workspaceDir);
  if (path === workspace || path.startsWith(`${workspace}/`)) {
    return `must not point inside workspace_dir (${workspaceDir})`;
  }
  return null;
}
