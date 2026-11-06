# Runtimes

A runtime is the agent CLI that executes a step: `claude` (Claude Code) or `opencode`. A specialist picks one with [`runtime`](specialists.md#fields). This page covers how `aip` finds and starts it, and what a `claude` specialist inherits from your own setup.

## `runtimes`

```yaml
runtimes:
  claude:
    command: /opt/claude/bin/claude   # a name from PATH or an absolute path
    args: [--debug]                   # put right after the command, before the arguments of aip
    env: { HTTPS_PROXY: "http://127.0.0.1:3128" }
  opencode:
    command: npx
    args: [-y, opencode-ai]
```

This section is set in the shared `settings.yaml` only. In a project `aip/settings.yaml` it is a validation error (`swarm.runtimes`).

- **`command`** is the agent CLI to start: a name looked up in `PATH`, or an absolute path (`~` is not expanded; a relative path with `/` is an error). The default is `claude` and `opencode`.
  - The order of choice is: `AIP_CLAUDE_BIN` / `AIP_OPENCODE_BIN` from the daemon's environment, then `command`, then `PATH`.
- **`args`** are put right after the command, before the arguments `aip` builds, for every start of the agent: a step, a retry, an answer and the request for a run name. A wrapper such as `npx -y opencode-ai` works this way: `npx -y opencode-ai run --format json …`.
  - `args` are also added when the command comes from `AIP_CLAUDE_BIN` / `AIP_OPENCODE_BIN`.
  - `aip` does not filter `args`: a flag such as `--dangerously-skip-permissions` weakens the limits of a specialist.
- **`env`** is added to the environment of the daemon for the agent process. The variables `aip` sets itself (`ENABLE_TOOL_SEARCH` for Claude Code, `OPENCODE_CONFIG` for OpenCode) win.

The daemon reads the section on every start of an agent, so a change takes effect without restarting the daemon, also in runs that are already under way.

- If the section is wrong, the step fails with `spawn error: invalid swarm.runtimes: …`.
- `aip setup` and `aip config check` use `command` only, not `args` and `env`.

## `claude.mcp`

- `isolated` (the default): the `claude` specialist sees only the `aip` server, with none of the MCP servers from your Claude Code settings.
- `inherit`: the specialist can use your servers too.

To give servers to one specialist only, use [`mcp`](specialists.md#mcp-servers).

## `claude.settings`

- `isolated` (the default): the `claude` specialist starts without your user-level Claude Code settings (`~/.claude/settings.json`).
  - Your hooks, plugins and permission rules do not apply to it. A hook that rewrites shell commands (for example, `npm run check` into `rtk npm run check`) cannot break the `allow_commands` patterns.
  - The project settings (`.claude/settings.json` and `.claude/settings.local.json` in the repository) and the project's instructions still apply. Your Claude Code login is not affected.
- `inherit`: the specialist reads your settings as well. Use it if the specialist needs `env` or `apiKeyHelper` from `~/.claude/settings.json`.

The one-off call that makes up a run title always goes without your settings.

## `claude.edit_mode`

How the `claude` runtime gets the `edit` level is described in [configuration/permissions.md](permissions.md#claudeedit_mode).

## What differs between runtimes

| | `claude` | `opencode` |
|---|---|---|
| Continuing a session | Always | By session id |
| Reporting denied commands | Yes | No, see [Denied commands](permissions.md#denied-commands) |
| Recognizing a [usage limit](../usage/queue.md#usage-limit) | Yes | No |
| [`tools`](specialists.md#tools), [`mcp`](specialists.md#mcp-servers) of a specialist | Yes | No |

Connecting the hosts themselves is a separate matter: see [hosts/claude-code.md](../hosts/claude-code.md) and [hosts/opencode.md](../hosts/opencode.md).
