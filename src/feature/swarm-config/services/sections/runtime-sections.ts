import { isMapping } from '../../types/merge.ts';
import {
  AGY_MCP_MODES,
  CLAUDE_EDIT_MODES,
  CLAUDE_MCP_MODES,
  CLAUDE_SETTINGS_SOURCES,
  OPENCODE_MCP_MODES,
  type AgySettings,
  type ClaudeSettings,
  type OpencodeSettings,
} from '../../types/settings.ts';
import {
  addError,
  readChoice,
  readEntries,
  readMapping,
  type ValidateContext,
} from '../validate-context.ts';

// Kept in sync with the launch-time defence in agents/types/overlay.ts.
const CLAUDE_RESERVED_KEYS = [
  'permissions',
  'hooks',
  'enableAllProjectMcpServers',
  'enabledMcpjsonServers',
  'disabledMcpjsonServers',
];

function readOverrides(
  ctx: ValidateContext,
  section: string,
  value: unknown,
): Record<string, unknown> | null {
  const path = `swarm.${section}.overrides`;
  const result = readMapping(ctx, value, path);
  if (!result) return null;
  if (section === 'claude') {
    for (const key of CLAUDE_RESERVED_KEYS) {
      if (Object.hasOwn(result, key)) addError(ctx, `${path}.${key}`, 'is reserved by aip');
    }
  }
  if (section === 'opencode') {
    if (isMapping(result.agent)) {
      for (const key of Object.keys(result.agent)) {
        if (key.startsWith('aip-')) addError(ctx, `${path}.agent.${key}`, 'is reserved by aip');
      }
    }
    if (isMapping(result.mcp) && Object.hasOwn(result.mcp, 'aip')) {
      addError(ctx, `${path}.mcp.aip`, 'is reserved by aip');
    }
  }
  return result;
}

export function checkClaude(ctx: ValidateContext, value: unknown, claude: ClaudeSettings): void {
  const mapping = readMapping(ctx, value, 'swarm.claude');
  if (!mapping) return;
  readEntries(ctx, mapping, 'swarm.claude', ['edit_mode', 'mcp', 'settings', 'overrides']);
  if ('edit_mode' in mapping)
    claude.editMode =
      readChoice(ctx, mapping.edit_mode, 'swarm.claude.edit_mode', CLAUDE_EDIT_MODES) ??
      claude.editMode;
  if ('mcp' in mapping)
    claude.mcp = readChoice(ctx, mapping.mcp, 'swarm.claude.mcp', CLAUDE_MCP_MODES) ?? claude.mcp;
  if ('settings' in mapping)
    claude.settings =
      readChoice(ctx, mapping.settings, 'swarm.claude.settings', CLAUDE_SETTINGS_SOURCES) ??
      claude.settings;
  if ('overrides' in mapping)
    claude.overrides = readOverrides(ctx, 'claude', mapping.overrides) ?? claude.overrides;
}

function checkRuntime(
  ctx: ValidateContext,
  section: 'opencode' | 'agy',
  value: unknown,
  settings: OpencodeSettings | AgySettings,
): void {
  const path = `swarm.${section}`;
  const mapping = readMapping(ctx, value, path);
  if (!mapping) return;
  readEntries(ctx, mapping, path, ['mcp', 'overrides']);
  if ('mcp' in mapping)
    settings.mcp =
      readChoice(
        ctx,
        mapping.mcp,
        `${path}.mcp`,
        section === 'agy' ? AGY_MCP_MODES : OPENCODE_MCP_MODES,
      ) ?? settings.mcp;
  if ('overrides' in mapping)
    settings.overrides = readOverrides(ctx, section, mapping.overrides) ?? settings.overrides;
}

export function checkOpencode(
  ctx: ValidateContext,
  value: unknown,
  settings: OpencodeSettings,
): void {
  checkRuntime(ctx, 'opencode', value, settings);
}

export function checkAgy(ctx: ValidateContext, value: unknown, settings: AgySettings): void {
  checkRuntime(ctx, 'agy', value, settings);
}
