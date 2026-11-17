import { PROTECTED_GIT_COMMANDS, type Endpoint, type LaunchContext } from '../../types/index.ts';
import type { AttemptServers } from '../policy/index.ts';

type Rule = 'allow' | 'deny';
type Permission = Record<string, Rule | Record<string, Rule>>;

const READ_TOOLS = ['read', 'glob', 'grep', 'list'];

/**
 * The tool rules of Kilo. Everything not named is denied, so an unknown tool call never asks a
 * person; the commands, the protected git commands and the exact MCP tools are listed explicitly
 * and stay denied under `--auto`.
 */
export function kiloPermission(context: LaunchContext, servers: AttemptServers): Permission {
  const { permissions, allowCommands } = context.specialist;
  const protectedRules = Object.fromEntries(
    PROTECTED_GIT_COMMANDS.map((command) => [`${command}*`, 'deny' as Rule]),
  );
  const mcp: Record<string, Rule> = {
    ...Object.fromEntries(servers.tools.map((tool) => [`${servers.worker}_${tool}`, 'allow'])),
    ...Object.fromEntries(servers.own.map((own) => [`${own.name}_*`, 'allow'])),
  };
  const bash: Record<string, Rule> =
    permissions === 'read'
      ? { '*': 'deny' }
      : permissions === 'edit'
        ? {
            '*': 'deny',
            ...Object.fromEntries(allowCommands.map((pattern) => [pattern, 'allow' as Rule])),
            ...protectedRules,
          }
        : { '*': 'allow', ...protectedRules };
  return {
    '*': 'deny',
    ...Object.fromEntries(READ_TOOLS.map((tool) => [tool, 'allow' as Rule])),
    edit: permissions === 'read' ? 'deny' : 'allow',
    bash,
    webfetch: 'allow',
    ...mcp,
    ...(context.attachmentsDirectory
      ? { external_directory: { [`${context.attachmentsDirectory}/**`]: 'allow' as Rule } }
      : {}),
  };
}

/** `provider/model` as Kilo names it: a model without a provider belongs to the own endpoint. */
export function kiloModel(model: string | null, endpoint: Endpoint | null): string | null {
  if (!model) return null;
  return endpoint && !model.includes('/') ? `aip/${model}` : model;
}

/**
 * The global config of the private XDG home of a conversation: the OpenAI-compatible provider with
 * `{env:KEY}` (never the key), the worker of this attempt and the servers of the specialist. The
 * file is replaced on every attempt; the history stays in the data and state folders.
 */
export function kiloConfig(
  context: LaunchContext,
  servers: AttemptServers,
  endpoint: Endpoint | null,
): Record<string, unknown> {
  const model = kiloModel(context.specialist.model, endpoint);
  const modelName = model?.replace(/^aip\//, '') ?? null;
  return {
    $schema: 'https://app.kilo.ai/config.json',
    ...(model ? { model } : {}),
    ...(endpoint && modelName
      ? {
          provider: {
            aip: {
              npm: '@ai-sdk/openai-compatible',
              name: 'aip',
              options: { baseURL: endpoint.baseUrl, apiKey: `{env:${endpoint.keyEnv}}` },
              models: { [modelName]: { name: modelName } },
            },
          },
        }
      : {}),
    mcp: {
      ...Object.fromEntries(
        servers.own.map((own) => [
          own.name,
          {
            type: 'local',
            command: [own.command, ...own.args],
            environment: own.env,
            enabled: true,
          },
        ]),
      ),
      [servers.worker]: {
        type: 'local',
        command: [servers.command, ...servers.args],
        enabled: true,
      },
    },
    permission: kiloPermission(context, servers),
  };
}
