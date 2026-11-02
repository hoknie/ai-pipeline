import { stringify } from 'yaml';

import {
  ConfigLoadError,
  configPathsFromEnvironment,
  formatDuration,
  loadConfigSources,
  type ResolvedConfig,
} from '../config/index.ts';
import { repositoryRoot } from '../git/index.ts';
import { findExecutable, runtimeFor } from '../runtime/index.ts';

import { probeVersion } from './probe.ts';

export function presentConfig(config: ResolvedConfig): unknown {
  return {
    max: config.max,
    workspace_dir: config.workspaceDir,
    workspace: { base: config.workspace.base, include: config.workspace.include },
    naming: {
      enabled: config.naming.enabled,
      runtime: config.naming.runtime,
      model: config.naming.model,
    },
    outside_changes: config.outsideChanges,
    claude: {
      edit_mode: config.claude.editMode,
      mcp: config.claude.mcp,
      settings: config.claude.settings,
    },
    delivery: {
      mode: config.delivery.mode,
      auto: config.delivery.auto,
      keep: config.delivery.keep,
      commit_message: config.delivery.commitMessage,
      ...(config.delivery.messageSpecialist
        ? { message_specialist: config.delivery.messageSpecialist }
        : {}),
      ...(config.delivery.resolver
        ? { resolver: config.delivery.resolver, resolver_rounds: config.delivery.resolverRounds }
        : {}),
    },
    specialists: Object.fromEntries(
      config.specialists.map((specialist) => [
        specialist.slug,
        {
          name: specialist.name,
          runtime: specialist.runtime,
          model: specialist.model ?? '(runtime default)',
          permissions: specialist.permissions,
          timeout: formatDuration(specialist.timeoutSeconds),
          allow_commands: specialist.allowCommands,
          ...(specialist.tools.length > 0 ? { tools: specialist.tools } : {}),
          skills: specialist.skills,
          ...(specialist.prompt ? { prompt: specialist.prompt } : {}),
          ...(specialist.max !== null ? { max: specialist.max } : {}),
          ...(specialist.queue ? { queue: true } : {}),
        },
      ]),
    ),
    workflows: Object.fromEntries(
      config.workflows.map((workflow) => [
        workflow.id,
        {
          ...(workflow.split
            ? {
                split: {
                  specialist: workflow.split.specialist,
                  max_groups: workflow.split.maxGroups,
                  ...(workflow.split.workflow ? { workflow: workflow.split.workflow } : {}),
                  ...(workflow.split.additionalPrompt
                    ? { additional_prompt: workflow.split.additionalPrompt }
                    : {}),
                },
              }
            : {}),
          ...(workflow.split?.workflow
            ? {}
            : {
                steps: workflow.steps.map((step) => ({
                  id: step.id,
                  specialist: step.specialist,
                  ...(step.onReject
                    ? {
                        on_reject: {
                          goto: step.onReject.goto,
                          max_rounds: step.onReject.maxRounds,
                        },
                      }
                    : {}),
                  ...(step.additionalPrompt ? { additional_prompt: step.additionalPrompt } : {}),
                })),
              }),
        },
      ]),
    ),
  };
}

export function configWarnings(config: ResolvedConfig): string[] {
  const warnings = config.specialists
    .filter((specialist) => specialist.permissions === 'full')
    .map(
      (specialist) =>
        `specialist \`${specialist.slug}\` has permissions: full and runs without any permission checks`,
    );
  const claudeEditors = config.specialists.some(
    (specialist) => specialist.runtime === 'claude' && specialist.permissions === 'edit',
  );
  if (config.claude.editMode === 'accept_edits' && claudeEditors) {
    warnings.push(
      'claude.edit_mode: accept_edits lets file system commands such as rm and mv run outside allow_commands',
    );
  }
  if (config.claude.editMode === 'auto' && claudeEditors) {
    warnings.push(
      'claude.edit_mode: auto lets the Claude Code classifier decide on commands outside allow_commands; it does not keep them inside the worktree',
    );
  }
  return warnings;
}

export async function checkConfig(directory: string, environment = process.env): Promise<number> {
  let config: ResolvedConfig;
  let files: string[];
  try {
    const repository = await repositoryRoot(directory);
    ({ config, files } = loadConfigSources(configPathsFromEnvironment(repository)));
  } catch (error) {
    process.stderr.write(
      `${error instanceof ConfigLoadError ? error.message : (error as Error).message}\n`,
    );
    return 1;
  }
  process.stdout.write(stringify({ swarm: presentConfig(config) }));
  const runtimes = [...new Set(config.specialists.map((specialist) => specialist.runtime))];
  process.stdout.write('\nConfig files:\n');
  for (const file of files) process.stdout.write(`  ${file}\n`);
  process.stdout.write('\nAgent CLIs:\n');
  for (const name of runtimes) {
    const runtime = runtimeFor(name, environment);
    const path = findExecutable(runtime.executable, environment.PATH);
    process.stdout.write(
      `  ${name}: ${path ? `${await probeVersion(path)} (${path})` : 'not found in PATH'}\n`,
    );
  }
  for (const warning of configWarnings(config)) process.stdout.write(`Warning: ${warning}\n`);
  return 0;
}
