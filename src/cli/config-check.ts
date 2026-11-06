import type { CliIo } from './io.ts';
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
    runtimes: Object.fromEntries(
      Object.entries(config.runtimes).map(([name, runtime]) => [
        name,
        {
          command: runtime.command,
          ...(runtime.args.length > 0 ? { args: runtime.args } : {}),
          ...(Object.keys(runtime.env).length > 0 ? { env: runtime.env } : {}),
        },
      ]),
    ),
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
      ...(config.delivery.messagePrompt ? { message_prompt: config.delivery.messagePrompt } : {}),
      ...(config.delivery.resolverPrompt
        ? { resolver_prompt: config.delivery.resolverPrompt }
        : {}),
    },
    ...(config.actions.length > 0
      ? {
          actions: Object.fromEntries(
            config.actions.map((action) => [
              action.id,
              {
                ...(action.name ? { name: action.name } : {}),
                ...(action.run !== null
                  ? { run: action.run, timeout: action.timeoutSeconds }
                  : { specialist: action.specialist }),
                ...(action.additionalPrompt ? { additional_prompt: action.additionalPrompt } : {}),
                on_failure: action.onFailure,
              },
            ]),
          ),
        }
      : {}),
    ...(Object.keys(config.stages).length > 0 ? { stages: config.stages } : {}),
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
          ...(specialist.mcp ? { mcp: Object.keys(specialist.mcp) } : {}),
          skills: specialist.skills,
          ...(specialist.prompt ? { prompt: specialist.prompt } : {}),
          ...(specialist.max !== null ? { max: specialist.max } : {}),
          ...(specialist.queue ? { queue: true } : {}),
        },
      ]),
    ),
    pipelines: Object.fromEntries(
      config.pipelines.map((pipeline) => [
        pipeline.id,
        {
          ...(pipeline.name ? { name: pipeline.name } : {}),
          ...(pipeline.stages && Object.keys(pipeline.stages).length > 0
            ? { stages: pipeline.stages }
            : {}),
          ...(pipeline.split
            ? {
                split: {
                  specialist: pipeline.split.specialist,
                  max_groups: pipeline.split.maxGroups,
                  ...(pipeline.split.pipeline ? { pipeline: pipeline.split.pipeline } : {}),
                  ...(pipeline.split.additionalPrompt
                    ? { additional_prompt: pipeline.split.additionalPrompt }
                    : {}),
                },
              }
            : {}),
          ...(pipeline.split?.pipeline
            ? {}
            : {
                steps: pipeline.steps.map((step) => ({
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
                  ...(step.humanReview ? { human_review: true } : {}),
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

export async function checkConfig(
  directory: string,
  io: Pick<CliIo, 'env' | 'stdout' | 'stderr'>,
): Promise<number> {
  const environment = io.env;
  let config: ResolvedConfig;
  let files: string[];
  let legacy: string[] = [];
  try {
    const repository = await repositoryRoot(directory);
    ({ config, files, legacy = [] } = loadConfigSources(configPathsFromEnvironment(repository)));
  } catch (error) {
    io.stderr(`${error instanceof ConfigLoadError ? error.message : (error as Error).message}\n`);
    return 1;
  }
  io.stdout(stringify({ swarm: presentConfig(config) }));
  const runtimes = [...new Set(config.specialists.map((specialist) => specialist.runtime))];
  io.stdout('\nConfig files:\n');
  for (const file of files) io.stdout(`  ${file}\n`);
  if (legacy.length > 0) {
    io.stdout('\nOld names (still read):\n');
    for (const file of legacy) io.stdout(`  ${file}\n`);
    io.stdout(
      '  Move the files to aip/pipelines/ and rename split.workflow to split.pipeline in them.\n',
    );
  }
  io.stdout('\nAgent CLIs:\n');
  for (const name of runtimes) {
    const runtime = runtimeFor(name, environment, config.runtimes);
    const path = findExecutable(runtime.executable, environment.PATH);
    io.stdout(
      `  ${name}: ${path ? `${await probeVersion(path)} (${path})` : 'not found in PATH'}\n`,
    );
  }
  for (const warning of configWarnings(config)) io.stdout(`Warning: ${warning}\n`);
  return 0;
}
