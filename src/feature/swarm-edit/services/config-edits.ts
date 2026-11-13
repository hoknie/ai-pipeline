import { rejected } from '../../../platform/errors/index.ts';
import type { AgentsService } from '../../agents/services/index.ts';
import type { ModelCatalogs, RuntimeCatalogs } from '../../agents/types/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import { pipelineTopologies, pipelineTopology } from '../../runs/types/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import {
  ConfigLoadError,
  configLoadErrors,
  defaultRuntimes,
} from '../../swarm-config/types/index.ts';
import type { ConfigChangedPort } from '../ports/index.ts';
import {
  ConfigEditError,
  systemStagesOf,
  type ConfigEditResult,
  type ConfigEditorView,
  type ConfigPreview,
  type EditRequest,
  type McpServerRequest,
  type PipelinesView,
  type SettingValue,
  type SystemStagesView,
  type WriteLevel,
} from '../types/index.ts';

import { commitEdit } from '../repositories/documents.ts';
import { editorView } from './editor-view.ts';
import { draftConfig, planEdit } from './plan-edit.ts';
import { planMcpServer } from './mcp/plan-mcp-server.ts';
import { planSettings } from './plan-settings.ts';
import type { SharedConfigService } from './shared-config.ts';

export interface ConfigEditDependencies {
  config: ConfigService;
  registry: RegistryService;
  agents: AgentsService;
  shared: SharedConfigService;
  changed: ConfigChangedPort;
}

/** A plan of the editor; its own errors become a refusal of the request. */
function planned<T>(plan: () => T): T {
  try {
    return plan();
  } catch (error) {
    if (error instanceof ConfigEditError) throw rejected(error.message);
    throw error;
  }
}

/** What the configuration editor of the panel reads and writes for one repository. */
export class ConfigEditService {
  private readonly dependencies: ConfigEditDependencies;

  constructor(dependencies: ConfigEditDependencies) {
    this.dependencies = dependencies;
  }

  async view(path: string): Promise<ConfigEditorView & { repository: string }> {
    const repository = await this.dependencies.registry.rootOf(path);
    return { repository, ...editorView(this.dependencies.config.pathsOf(repository)) };
  }

  /** Tools and skills a specialist of the repository can name. */
  async catalog(
    path: string,
  ): Promise<{ repository: string; mcpInherited: boolean; runtimes: RuntimeCatalogs }> {
    const { config, registry, agents } = this.dependencies;
    const repository = await registry.rootOf(path);
    let mcpInherited = false;
    try {
      mcpInherited = config.load(repository).claude.mcp === 'inherit';
    } catch {
      mcpInherited = false;
    }
    return { repository, mcpInherited, runtimes: agents.catalog(repository, config.home()) };
  }

  /** The models of every runtime for the repository; cached by the daemon until `refresh`. */
  async models(
    path: string,
    refresh: boolean,
  ): Promise<{ repository: string; runtimes: ModelCatalogs }> {
    const { config, registry, agents } = this.dependencies;
    const repository = await registry.rootOf(path);
    let settings = defaultRuntimes();
    try {
      settings = config.load(repository).runtimes;
    } catch {
      settings = defaultRuntimes();
    }
    return { repository, runtimes: await agents.models(repository, settings, refresh) };
  }

  /** Check and write run without an await between them, so two edits never interleave. */
  async edit(path: string, edit: EditRequest): Promise<ConfigEditResult> {
    const { config, registry, shared, changed } = this.dependencies;
    const repository = await registry.rootOf(path);
    const plan = planned(() => planEdit(config.pathsOf(repository), edit));
    if (!plan.ok) return plan;
    if (
      (edit.kind === 'specialist' || edit.kind === 'pipeline') &&
      edit.value === null &&
      edit.level === 'global'
    ) {
      const references =
        edit.kind === 'specialist'
          ? shared.specialistUsageOf(repository, edit.id)
          : shared.pipelineUsageOf(repository, edit.id);
      if (references.length > 0) return { ok: false, reason: 'invalid', errors: [], references };
    }
    const result = { ok: true as const, ...commitEdit(plan) };
    changed.configChanged(repository);
    return result;
  }

  async settings(params: {
    repository: string;
    values: Record<string, SettingValue>;
    revision: string | null;
    level: WriteLevel;
  }): Promise<ConfigEditResult> {
    const { config, registry, changed } = this.dependencies;
    const repository = await registry.rootOf(params.repository);
    const plan = planned(() =>
      planSettings(config.pathsOf(repository), {
        values: params.values,
        revision: params.revision,
        level: params.level,
      }),
    );
    if (!plan.ok) return plan;
    const result = { ok: true as const, ...commitEdit(plan) };
    changed.configChanged(repository);
    return result;
  }

  /** Writes or removes one server of the `mcp_servers` catalog of a level. */
  async mcpServer(repositoryPath: string, request: McpServerRequest): Promise<ConfigEditResult> {
    const { config, registry, changed } = this.dependencies;
    const repository = await registry.rootOf(repositoryPath);
    const plan = planned(() => planMcpServer(config.pathsOf(repository), request));
    if (!plan.ok) return plan;
    const result = { ok: true as const, ...commitEdit(plan) };
    changed.configChanged(repository);
    return result;
  }

  /** The graph of a pipeline as it would be with the draft value. */
  async preview(params: {
    repository: string;
    kind: EditRequest['kind'];
    id: string;
    value: EditRequest['value'];
    level?: WriteLevel | undefined;
  }): Promise<ConfigPreview> {
    const repository = await this.dependencies.registry.rootOf(params.repository);
    const { config, errors } = draftConfig(this.dependencies.config.pathsOf(repository), {
      kind: params.kind,
      id: params.id,
      value: params.value,
      level: params.level ?? 'project',
    });
    return { topology: config ? pipelineTopology(config, params.id) : null, errors };
  }

  async pipelines(path: string): Promise<PipelinesView> {
    const repository = await this.dependencies.registry.rootOf(path);
    try {
      const config = this.dependencies.config.load(repository);
      return { repository, pipelines: pipelineTopologies(config), errors: [] };
    } catch (error) {
      if (!(error instanceof ConfigLoadError)) throw error;
      return { repository, pipelines: [], errors: configLoadErrors(error) };
    }
  }

  /** The built-in stages of the pipeline with their tasks and the settings that apply. */
  async systemStages(path: string): Promise<SystemStagesView> {
    const repository = await this.dependencies.registry.rootOf(path);
    const paths = this.dependencies.config.pathsOf(repository);
    try {
      const config = this.dependencies.config.load(repository);
      const settings = new Map(
        editorView(paths).settings.map((setting) => [setting.path, setting]),
      );
      return { repository, stages: systemStagesOf(config, settings), errors: [] };
    } catch (error) {
      if (!(error instanceof ConfigLoadError)) throw error;
      return { repository, stages: [], errors: configLoadErrors(error) };
    }
  }
}
