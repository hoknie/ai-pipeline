import { PROTECTED_GIT_COMMANDS, type LaunchContext } from '../../types/index.ts';

/** Precise command checks belong to PreToolUse, not agy's broader native prefix rules. */
export function agySettings(context: LaunchContext, server: string): Record<string, unknown> {
  const { permissions } = context.specialist;
  return {
    agentMode: permissions === 'read' ? '' : 'accept-edits',
    toolPermission: permissions === 'full' ? 'always-proceed' : 'request-review',
    enableTerminalSandbox: false,
    allowNonWorkspaceAccess: permissions === 'full',
    artifactReviewPolicy: 'always-proceed',
    permissions: {
      allow: [`read_file(${context.worktree})`, `mcp(${server}/*)`],
      ask: [],
      deny: [
        ...(permissions === 'read' ? ['write_file(*)', 'command(*)'] : []),
        ...PROTECTED_GIT_COMMANDS.map((command) => `command(${command})`),
      ],
    },
  };
}

export const AGY_ONE_SHOT_SETTINGS = {
  agentMode: '',
  toolPermission: 'request-review',
  enableTerminalSandbox: false,
  artifactReviewPolicy: 'always-proceed',
  allowNonWorkspaceAccess: false,
  permissions: {
    allow: [],
    ask: [],
    deny: [
      'read_file(*)',
      'write_file(*)',
      'command(*)',
      'read_url(*)',
      'execute_url(*)',
      'mcp(*)',
    ],
  },
};
