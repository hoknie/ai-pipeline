import type { AttemptServers } from '../policy/index.ts';

/** `mcp-config.json` of the private home: this attempt's worker and the servers of the specialist. */
export function mcpConfig(servers: AttemptServers): string {
  return JSON.stringify(
    {
      mcpServers: {
        ...Object.fromEntries(
          servers.own.map((own) => [
            own.name,
            { type: 'local', command: own.command, args: own.args, env: own.env, tools: ['*'] },
          ]),
        ),
        [servers.worker]: {
          type: 'local',
          command: servers.command,
          args: servers.args,
          tools: servers.tools,
        },
      },
    },
    null,
    2,
  );
}

/** The pre-tool hook of the private home: the gate decides every shell, file and MCP action. */
export function hooksConfig(command: string): string {
  return JSON.stringify({
    version: 1,
    hooks: { preToolUse: [{ type: 'command', bash: command, cwd: '.', timeoutSec: 10 }] },
  });
}
