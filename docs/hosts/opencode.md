# OpenCode

`aip` works in OpenCode through the MCP server, which gives the model the [`swarm_*` tools](mcp-tools.md). `aip setup` connects it (see [getting-started/install.md](../getting-started/install.md#what-aip-setup-does)). As a runtime for specialists, OpenCode is described in [configuration/runtimes.md](../configuration/runtimes.md).

## Connect by hand

Add the server to `~/.config/opencode/opencode.json` (or to the project's `opencode.json`):

```json
{
  "mcp": {
    "aip": { "type": "local", "command": ["aip", "mcp"], "enabled": true }
  }
}
```

To check, run `opencode mcp list`. It shows `aip` as `connected`.

## Using it

- In OpenCode the tools are named with the server prefix: `aip_swarm_status`, `aip_swarm_run`, and for a specialist `aip_swarm_report`.
- A specialist with `runtime: opencode` runs under an agent that `aip` generates: `bash` outside `allow_commands` is refused, and `-s <session>` continues a session. See [Permission levels](../configuration/permissions.md#permission-levels).
- `aip group show` prints the OpenCode log of a step with its tokens.

`aip` has been checked against OpenCode 1.18.35.

## Troubleshooting

If `opencode run` prints nothing for minutes, the cause is usually not the model but a global MCP server in your own OpenCode configuration that does not start or needs authorization. Disable such servers (`"enabled": false`) or check them with `opencode mcp list`.

A failed request ends with an `error` event; `aip` shows its `data.message` as the reason of the step.
