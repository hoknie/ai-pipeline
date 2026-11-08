import type { CliIo } from '../io.ts';
import { stringify } from 'yaml';

import {
  ConfigLoadError,
  formatDuration,
  type ResolvedConfig,
} from '../../../feature/swarm-config/types/index.ts';
import {
  configPathsFromEnvironment,
  loadConfigSources,
} from '../../../feature/swarm-config/services/index.ts';
import { repositoryRoot } from '../../../platform/git/index.ts';
import { findExecutable } from '../../../platform/process/index.ts';
import { agentExecutable } from '../../../app/maintenance.ts';

import { probeVersion } from '../probe.ts';

type Config = ResolvedConfig;

function presentRuntimes(config: Config): unknown {
  return Object.fromEntries(
    Object.entries(config.runtimes).map(([name, runtime]) => [
      name,
      {
        command: runtime.command,
        ...(runtime.args.length > 0 ? { args: runtime.args } : {}),
        ...(Object.keys(runtime.env).length > 0 ? { env: runtime.env } : {}),
      },
    ]),
  );
}

function presentDelivery(config: Config): unknown {
  return {
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
    ...(config.delivery.resolverPrompt ? { resolver_prompt: config.delivery.resolverPrompt } : {}),
  };
}

function presentActions(config: Config): unknown {
  return Object.fromEntries(
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
  );
}

function presentChains(config: Config): unknown {
  return Object.fromEntries(
    config.chains.map((chain) => [
      chain.slug,
      {
        name: chain.name,
        mode: chain.mode,
        runtimes: chain.runtimes.map((item) => ({
          runtime: item.runtime,
          ...(item.model ? { model: item.model } : {}),
          ...(item.variant ? { variant: item.variant } : {}),
          ...(item.reasoningEffort ? { reasoning_effort: item.reasoningEffort } : {}),
          ...(item.enabled ? {} : { enabled: false }),
        })),
        ...(chain.enabled ? {} : { enabled: false }),
      },
    ]),
  );
}

function presentSpecialists(config: Config): unknown {
  return Object.fromEntries(
    config.specialists.map((specialist) => [
      specialist.slug,
      {
        name: specialist.name,
        ...(specialist.runtimeChain
          ? { runtime_chain: specialist.runtimeChain }
          : {
              runtime: specialist.runtime,
              model: specialist.model ?? '(runtime default)',
              ...(specialist.variant ? { variant: specialist.variant } : {}),
              ...(specialist.reasoningEffort
                ? { reasoning_effort: specialist.reasoningEffort }
                : {}),
            }),
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
  );
}

function presentSteps(pipeline: Config['pipelines'][number]): unknown {
  return pipeline.steps.map((step) => ({
    id: step.id,
    specialist: step.specialist,
    ...(step.onReject
      ? { on_reject: { goto: step.onReject.goto, max_rounds: step.onReject.maxRounds } }
      : {}),
    ...(step.additionalPrompt ? { additional_prompt: step.additionalPrompt } : {}),
    ...(step.humanReview ? { human_review: true } : {}),
  }));
}

function presentSplit(split: NonNullable<Config['pipelines'][number]['split']>): unknown {
  return {
    specialist: split.specialist,
    max_groups: split.maxGroups,
    ...(split.pipeline ? { pipeline: split.pipeline } : {}),
    ...(split.additionalPrompt ? { additional_prompt: split.additionalPrompt } : {}),
  };
}

function presentPipelines(config: Config): unknown {
  return Object.fromEntries(
    config.pipelines.map((pipeline) => [
      pipeline.id,
      {
        ...(pipeline.name ? { name: pipeline.name } : {}),
        ...(pipeline.stages && Object.keys(pipeline.stages).length > 0
          ? { stages: pipeline.stages }
          : {}),
        ...(pipeline.split ? { split: presentSplit(pipeline.split) } : {}),
        ...(pipeline.split?.pipeline ? {} : { steps: presentSteps(pipeline) }),
      },
    ]),
  );
}

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
    runtimes: presentRuntimes(config),
    outside_changes: config.outsideChanges,
    claude: {
      edit_mode: config.claude.editMode,
      mcp: config.claude.mcp,
      settings: config.claude.settings,
    },
    delivery: presentDelivery(config),
    ...(config.actions.length > 0 ? { actions: presentActions(config) } : {}),
    ...(config.chains.length > 0 ? { chains: presentChains(config) } : {}),
    ...(Object.keys(config.stages).length > 0 ? { stages: config.stages } : {}),
    specialists: presentSpecialists(config),
    pipelines: presentPipelines(config),
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
    ({
      config,
      files,
      legacy = [],
    } = loadConfigSources(configPathsFromEnvironment(repository, environment)));
  } catch (error) {
    io.stderr(`${error instanceof ConfigLoadError ? error.message : (error as Error).message}\n`);
    return 1;
  }
  io.stdout(stringify({ swarm: presentConfig(config) }));
  const specialistRuntimes = config.specialists.flatMap((specialist) => {
    if (!specialist.runtimeChain) return [specialist.runtime];
    const chain = config.chains.find((c) => c.slug === specialist.runtimeChain);
    if (!chain || !chain.enabled) return [config.defaults.runtime];
    const active = chain.runtimes.filter((r) => r.enabled).map((r) => r.runtime);
    return active.length > 0 ? active : [config.defaults.runtime];
  });
  const runtimes = [...new Set(specialistRuntimes)];
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
    const path = findExecutable(
      agentExecutable(name, environment, config.runtimes),
      environment.PATH,
    );
    io.stdout(
      `  ${name}: ${path ? `${await probeVersion(path)} (${path})` : 'not found in PATH'}\n`,
    );
  }
  for (const warning of configWarnings(config)) io.stdout(`Warning: ${warning}\n`);
  return 0;
}
