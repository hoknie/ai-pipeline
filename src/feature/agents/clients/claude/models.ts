import type { ModelEntry } from '../../types/index.ts';

const ALIASES = ['opus', 'sonnet', 'haiku'];
const FULL_IDS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'];

/** Claude Code cannot list its models, so the list is built in: aliases first, then full ids. */
export const CLAUDE_MODELS: ModelEntry[] = [
  ...ALIASES.map((id) => ({ id, name: id, group: 'aliases' })),
  ...FULL_IDS.map((id) => ({ id, name: id, group: 'anthropic' })),
];
