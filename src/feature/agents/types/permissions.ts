import type {
  ClaudeEditMode,
  ClaudeSettingsSource,
  Permissions,
  ResolvedConfig,
  RuntimeChain,
  Specialist,
} from '../../swarm-config/types/index.ts';

/** Permissions of one specialist as the current configuration defines them. */
export interface SpecialistPermissions {
  permissions: Permissions;
  allowCommands: string[];
  tools: string[];
  queue: boolean;
}

/**
 * Permissions read from the current configuration before a retry or an answer, or the reason they
 * could not be read.
 */
export type PermissionsRefresh =
  | {
      specialists: Record<string, SpecialistPermissions>;
      claudeEditMode: ClaudeEditMode;
      claudeSettings: ClaudeSettingsSource;
    }
  | { error: string };

/** Permissions of every specialist of a configuration, for a refresh. */
export function permissionsOf(config: ResolvedConfig): PermissionsRefresh {
  const specialists: Record<string, SpecialistPermissions> = {};
  for (const specialist of config.specialists) {
    specialists[specialist.slug] = {
      permissions: specialist.permissions,
      allowCommands: [...specialist.allowCommands],
      tools: [...specialist.tools],
      queue: specialist.queue === true,
    };
  }
  return {
    specialists,
    claudeEditMode: config.claude.editMode,
    claudeSettings: config.claude.settings,
  };
}

/**
 * Copies refreshed permissions into the snapshot of a run; prompts, models and the rest stay.
 * Specialists missing from the refresh keep their permissions. Returns the error to warn about.
 */
export function refreshPermissions(
  config: ResolvedConfig,
  refresh: PermissionsRefresh,
): string | null {
  if ('error' in refresh) return refresh.error;
  for (const specialist of config.specialists) {
    const fresh = refresh.specialists[specialist.slug];
    if (!fresh) continue;
    specialist.permissions = fresh.permissions;
    specialist.allowCommands = [...fresh.allowCommands];
    specialist.tools = [...fresh.tools];
    specialist.queue = fresh.queue === true;
  }
  config.claude.editMode = refresh.claudeEditMode;
  config.claude.settings = refresh.claudeSettings;
  return null;
}

/** Whole definitions of the specialists of the current configuration, for a retry with it. */
export interface SpecialistsRefresh {
  specialists: Specialist[];
  chains?: RuntimeChain[];
  claudeEditMode: ClaudeEditMode;
  claudeSettings: ClaudeSettingsSource;
}

function copySpecialist(specialist: Specialist): Specialist {
  return {
    ...specialist,
    allowCommands: [...specialist.allowCommands],
    tools: [...specialist.tools],
    skills: [...specialist.skills],
  };
}

/** Specialists of a configuration, for a retry with the current configuration. */
export function specialistsOf(config: ResolvedConfig): SpecialistsRefresh {
  return {
    specialists: config.specialists.map(copySpecialist),
    chains: config.chains.map((chain) => ({
      ...chain,
      runtimes: chain.runtimes.map((r) => ({ ...r })),
    })),
    claudeEditMode: config.claude.editMode,
    claudeSettings: config.claude.settings,
  };
}

const SCALAR_FIELDS = [
  ['model', 'model'],
  ['variant', 'variant'],
  ['reasoningEffort', 'reasoning_effort'],
  ['runtime', 'runtime'],
  ['runtimeChain', 'runtime_chain'],
  ['permissions', 'permissions'],
  ['timeoutSeconds', 'timeout'],
  ['max', 'max'],
  ['queue', 'queue'],
  ['level', 'level'],
] as const;

const LIST_FIELDS = [
  ['allowCommands', 'allow_commands'],
  ['tools', 'tools'],
  ['skills', 'skills'],
] as const;

function shown(value: unknown): string {
  return value === null || value === undefined ? 'none' : String(value);
}

function listChange(before: readonly string[], after: readonly string[]): string | null {
  const added = after.filter((item) => !before.includes(item)).map((item) => `+${item}`);
  const removed = before.filter((item) => !after.includes(item)).map((item) => `−${item}`);
  const parts = [...added, ...removed];
  return parts.length > 0 ? parts.join(' ') : null;
}

function specialistChanges(before: Specialist, after: Specialist): string[] {
  const changes: string[] = [];
  for (const [field, label] of SCALAR_FIELDS) {
    // Snapshots made before `queue` and `level` existed have no value: not a change.
    if (before[field] === undefined && field !== 'variant' && field !== 'reasoningEffort') continue;
    if ((before[field] ?? null) !== (after[field] ?? null)) {
      changes.push(`${before.slug} ${label} ${shown(before[field])} → ${shown(after[field])}`);
    }
  }
  if (before.prompt !== after.prompt) changes.push(`${before.slug} prompt`);
  for (const [field, label] of LIST_FIELDS) {
    const change = listChange(before[field] ?? [], after[field] ?? []);
    if (change !== null) changes.push(`${before.slug} ${label} ${change}`);
  }
  return changes;
}

/**
 * Replaces the definitions of the snapshot's specialists with the current ones; specialists missing
 * from the refresh keep theirs, and no specialist is added. The pipeline and the rest of the
 * snapshot stay. Returns the changes, empty when nothing changed.
 */
export function refreshSpecialists(config: ResolvedConfig, refresh: SpecialistsRefresh): string[] {
  const changes: string[] = [];
  config.specialists = config.specialists.map((specialist) => {
    const fresh = refresh.specialists.find((candidate) => candidate.slug === specialist.slug);
    if (!fresh) {
      changes.push(`${specialist.slug} kept from snapshot`);
      return specialist;
    }
    changes.push(...specialistChanges(specialist, fresh));
    return copySpecialist(fresh);
  });
  if (config.claude.editMode !== refresh.claudeEditMode) {
    changes.push(`claude.edit_mode ${config.claude.editMode} → ${refresh.claudeEditMode}`);
  }
  if (config.claude.settings !== refresh.claudeSettings) {
    changes.push(`claude.settings ${config.claude.settings} → ${refresh.claudeSettings}`);
  }
  config.claude.editMode = refresh.claudeEditMode;
  config.claude.settings = refresh.claudeSettings;
  if (refresh.chains) {
    config.chains = refresh.chains.map((chain) => ({
      ...chain,
      runtimes: chain.runtimes.map((r) => ({ ...r })),
    }));
  }
  return changes;
}

/** A tool call refused by the agent CLI; `command` is set for shell commands. */
export interface Denial {
  tool: string;
  command: string | null;
}

/** One part of a refused command and the allow_commands pattern that would let it run. */
export interface Suggestion {
  part: string;
  /** null when no pattern can allow the part (a loop, a condition, a here-document). */
  pattern: string | null;
}

const MULTI_WORD = new Set([
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'git',
  'claude',
  'docker',
  'cargo',
  'go',
]);

const COMPOUND = new Set(['for', 'while', 'until', 'if', 'case', 'select', 'function']);

/** Splits a shell command on `&&`, `||`, `;`, `|` and newlines outside quotes. */
export function commandParts(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let index = 0; index < command.length; index++) {
    const char = command[index] as string;
    if (quote) {
      if (char === '\\' && quote === '"' && index + 1 < command.length) {
        current += char + command[index + 1];
        index++;
        continue;
      }
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === '\\' && index + 1 < command.length) {
      current += char + command[index + 1];
      index++;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    // A here-document body belongs to its command: keep the rest whole.
    if (char === '<' && command[index + 1] === '<' && command[index + 2] !== '<') {
      current += command.slice(index);
      break;
    }
    const pair = command.slice(index, index + 2);
    if (pair === '&&' || pair === '||') {
      parts.push(current);
      current = '';
      index++;
      continue;
    }
    if (char === ';' || char === '|' || char === '\n') {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** Whether a command matches a Claude Code prefix pattern such as `npm run check*` or `ls *`. */
export function matchesPattern(command: string, pattern: string): boolean {
  if (!pattern.endsWith('*')) return command === pattern;
  const prefix = pattern.slice(0, -1);
  if (command.startsWith(prefix)) return true;
  // `ls *` also allows a bare `ls`.
  return prefix.endsWith(' ') && command === prefix.trimEnd();
}

function patternFor(part: string): string | null {
  const words = part.split(/\s+/);
  const first = words[0] ?? '';
  if (COMPOUND.has(first) || part.includes('<<') || first.includes('=') || first === '')
    return null;
  const second = words[1];
  if (MULTI_WORD.has(first) && second && !second.startsWith('-') && /^[\w:.@/-]+$/.test(second)) {
    return `${first} ${second} *`;
  }
  return `${first} *`;
}

/** Patterns for the parts of a refused command that no allow_commands pattern covers. */
export function suggestPatterns(command: string, allowCommands: readonly string[]): Suggestion[] {
  const parts = commandParts(command);
  // A loop or a condition spans several parts; no pattern allows it as a whole.
  if (parts.some((part) => COMPOUND.has(part.split(/\s+/)[0] ?? ''))) {
    return [{ part: command.trim(), pattern: null }];
  }
  const suggestions: Suggestion[] = [];
  for (const part of parts) {
    if (part === 'cd' || part.startsWith('cd ')) continue;
    if (allowCommands.some((pattern) => matchesPattern(part, pattern))) continue;
    suggestions.push({ part, pattern: patternFor(part) });
  }
  return suggestions;
}
