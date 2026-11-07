import type { RuntimeCatalogs } from '../feature/agents/types/index.ts';
import {
  defaultRuntimes,
  type Runtime as RuntimeName,
  type RuntimeSettings,
} from '../feature/swarm-config/types/index.ts';

import { createClaudeRuntime } from './claude.ts';
import { mcpServers, skillCatalog, sortEntries } from './catalog.ts';
import { createOpencodeRuntime } from './opencode.ts';
import type { Runtime } from './types.ts';

export {
  claudeAllowedTools,
  claudePermissionArgs,
  claudeTools,
  createClaudeRuntime,
} from './claude.ts';
export { systemPrompt, userMessage } from './message.ts';
export { createOpencodeRuntime, opencodeAgentName, opencodePermission } from './opencode.ts';
export { missingSkills, skillCandidates } from './skills.ts';
export { claudeTranscript, opencodeTranscript, toolSummary } from './transcript.ts';
export { answerText, namingPrompt, parseNaming, type RunNaming } from './naming.ts';
export * from './types.ts';

export function runtimeFor(
  name: RuntimeName,
  environment: NodeJS.ProcessEnv,
  settings: RuntimeSettings = defaultRuntimes(),
): Runtime {
  const { command, args, env } = settings[name];
  return name === 'claude'
    ? createClaudeRuntime(environment.AIP_CLAUDE_BIN || command, { args, env })
    : createOpencodeRuntime(environment.AIP_OPENCODE_BIN || command, { args, env });
}

export { mcpServers, skillCatalog } from './catalog.ts';

/** Tools and skills a specialist of each runtime can name, read from disk on every call. */
export function runtimeCatalog(
  repository: string,
  home: string,
  environment: NodeJS.ProcessEnv,
): RuntimeCatalogs {
  const build = (name: RuntimeName) => {
    const runtime = runtimeFor(name, environment);
    const servers = name === 'claude' ? mcpServers(repository, home) : [];
    return {
      tools: sortEntries([
        ...runtime.builtinTools.map((tool) => ({ name: tool, source: 'builtin' as const })),
        ...servers,
      ]),
      skills: skillCatalog(runtime.skillDirectories(repository, home), repository, home),
    };
  };
  return { claude: build('claude'), opencode: build('opencode') };
}
