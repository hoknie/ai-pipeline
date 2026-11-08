import { commandParts, matchesPattern, PROTECTED_GIT_COMMANDS } from '../../types/index.ts';

/** Refuse syntax requiring shell evaluation rather than treating it as a literal prefix. */
function simple(part: string): boolean {
  return !/[`$<>\n\r\\(){}&]/.test(part) && !/^[\s]*(?:\w+=|for\b|while\b|if\b|case\b)/.test(part);
}

function protectedGit(part: string): boolean {
  // Flags, wrappers and quoted executable names are not transparent to a prefix allowlist.
  const normalized = part.replace(/["']/g, '');
  if (/\bgit\b/.test(normalized) && !/^git\s+[a-z][\w-]*(?:\s|$)/.test(normalized)) return true;
  return PROTECTED_GIT_COMMANDS.some((command) => matchesPattern(normalized, `${command} *`));
}

export function allowedCommand(command: unknown, patterns: string[] | null): boolean {
  if (typeof command !== 'string' || !command.trim()) return false;
  const parts = commandParts(command);
  return (
    parts.length > 0 &&
    parts.every((part) => {
      if (!simple(part) || protectedGit(part)) return false;
      if (patterns === null) return true;
      // Prevent a prefix from authorizing an embedded interpreter or directory change.
      if (/^(?:cd|env|exec|eval|command|builtin|source|sudo|sh|bash|zsh)\b/.test(part))
        return false;
      return patterns.some((pattern) => matchesPattern(part, pattern));
    })
  );
}
