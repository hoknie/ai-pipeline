import type {
  ClaudeEditMode,
  ClaudeSettingsSource,
  Permissions,
  ResolvedConfig,
} from '../config/index.ts';

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
