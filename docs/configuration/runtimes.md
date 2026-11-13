# Runtimes

A runtime is the agent CLI that executes a step: `claude` (Claude Code), `opencode`, or `agy` (Antigravity CLI). A specialist picks one with [`runtime`](specialists.md#fields). This page covers how `aip` finds and starts it, and what a specialist inherits from your own setup.

## `runtimes`

```yaml
runtimes:
  claude:
    enabled: true                     # off until you switch it on
    command: /opt/claude/bin/claude   # a name from PATH or an absolute path
    args: [--debug]                   # put right after the command, before the arguments of aip
    env: { HTTPS_PROXY: "http://127.0.0.1:3128" }
  opencode:
    enabled: true
    command: npx
    args: [-y, opencode-ai]
  agy:
    command: agy
    args: [--effort, high]
```

This section is set in the shared `settings.yaml` only. In a project `aip/settings.yaml` it is a validation error (`swarm.runtimes`).

- **`enabled`** switches the runtime on or off. Every runtime is off until you switch it on: without the field, `aip` does not start it. A step of a specialist on a runtime that is off fails with `runtime disabled: <name>` (a chain with `on_error` moves on to its next item), the request for a run name is skipped and the list of its models stays empty.
  - [Observers](../usage/runs.md#observers) do not repair such a failure and do not start a repair on a runtime that is off.
  - A non-empty `AIP_CLAUDE_BIN` / `AIP_OPENCODE_BIN` / `AIP_AGY_BIN` in the daemon's environment switches the runtime on while `enabled` is not set. An explicit `enabled: false` wins over the variable.
  - Switch it in the panel (Settings → Runtimes → Enabled) or set `runtimes.<name>.enabled: true` in the shared `settings.yaml`. To go back to an older `aip`, remove `enabled` from the file first.
- **`command`** is the agent CLI to start: a name looked up in `PATH`, or an absolute path (`~` is not expanded; a relative path with `/` is an error). The default is the runtime's name: `claude`, `opencode` or `agy`.
  - The order of choice is: `AIP_CLAUDE_BIN` / `AIP_OPENCODE_BIN` / `AIP_AGY_BIN` from the daemon's environment, then `command`, then `PATH`.
- **`args`** are put right after the command, before the arguments `aip` builds, for every start of the agent: a step, a retry, an answer and the request for a run name. A wrapper such as `npx -y opencode-ai` works this way: `npx -y opencode-ai run --format json …`.
  - `args` are also added when the command comes from `AIP_CLAUDE_BIN` / `AIP_OPENCODE_BIN` / `AIP_AGY_BIN`.
  - `aip` does not filter `args`: a flag such as `--dangerously-skip-permissions` weakens the limits of a specialist.
- **`env`** is added to the environment of the daemon for the agent process. The variables `aip` sets itself (`ENABLE_TOOL_SEARCH` for Claude Code, `OPENCODE_CONFIG` for OpenCode) win.

The daemon reads the section on every start of an agent, so a change takes effect without restarting the daemon, also in runs that are already under way.

- If the section is wrong, the step fails with `spawn error: invalid swarm.runtimes: …`.
- `aip setup` and `aip config check` use `command` only, not `args` and `env`.

## OpenCode model options

An explicitly configured OpenCode model must use `provider/model` (for example `openai/gpt-6.1-sol`). Any provider and additional `/` characters in the model suffix are allowed; the ID is passed unchanged. Short aliases such as `luna-6.1` are invalid and are not automatically completed. Omitting the model remains valid and lets OpenCode choose its default.

If a previous run contains a short model ID, update the specialist or chain with the full ID
you intend to use, then explicitly retry with the current configuration (`refresh_config`).
A normal retry deliberately uses the original snapshot and will reject the old ID. Existing
attempts remain in history; no automatic migration or provider guess is performed. An invalid
model on the optional naming generator is skipped and the run keeps its fallback name.
For example, `model: gpt-5` on an OpenCode specialist is reported at
`swarm.specialists.<slug>.model` with `OpenCode model "gpt-5" must use provider/model format`;
the equivalent chain error points to `swarm.chains.<slug>.runtimes[<index>].model`.

```yaml
name: Fallback
mode: on_error
runtimes:
  - runtime: opencode
    model: openai/gpt-6.1-sol
```

The specialist fields `variant` and `reasoning_effort` apply to every launch of an OpenCode specialist, including retries and answers:

- `variant` is passed together with the unchanged model as `-m <provider/model>#<variant>`. OpenCode 2 names a variant only together with a model, so `variant` requires `model`; without one the configuration is rejected at the `variant` field.
- `reasoning_effort` is written as `options.reasoningEffort` of the generated agent in the attempt's `opencode.json`.
- With neither field set, `aip` leaves both options unset. The effective choice depends on OpenCode's configuration and the provider.

```yaml
name: OpenCode reviewer
runtime: opencode
model: openai/gpt-6.1-sol
variant: high
reasoning_effort: low
permissions: read
```

OpenCode applies the selected variant after the agent options. A variant that sets `reasoningEffort` overrides the explicit base effort; a variant without an effort leaves it in effect. Support depends on the model and provider.

## Antigravity CLI (`agy`)

`agy` runs headlessly with a machine-readable JSON stream. Its `conversation_id` is resumed for the same specialist after a human answer. The CLI uses your existing Antigravity authentication; `aip` does not sign in or edit your personal Antigravity settings.

- The user-level command is controlled by the normal `runtimes.agy` settings or `AIP_AGY_BIN`.
- Skills are read from `.agents/skills` and the standard Antigravity folders under `~/.gemini`.
- Antigravity model names are passed through unchanged. Without `model`, Antigravity selects its default.
- `agy` does not report a billing cost. Token usage on a resumed conversation is cumulative, so only usage attributable to the current attempt is counted.
- `aip` applies its own permission check to file writes and commands. A shell command is denied unless it matches `allow_commands`; commands with uninspectable shell syntax are denied.
- `variant` and `reasoning_effort` are OpenCode-only and cannot be used with agy.

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

| | `claude` | `opencode` | `agy` |
|---|---|---|---|
| Continuing a session | Always | By session id | By `conversation_id` |
| Reporting denied commands | Yes | No, see [Denied commands](permissions.md#denied-commands) | Shown in the journal |
| Recognizing a [usage limit](../usage/queue.md#usage-limit) | Yes | No | No |
| [`tools`](specialists.md#tools), [`mcp`](specialists.md#mcp-servers) of a specialist | Yes | No | No |

## Runtime chains

A runtime chain defines a pool of runtimes and models for a specialist. Every chain is one file in `aip/chains/<slug>.yaml` (project level) or `~/.config/aip/chains/<slug>.yaml` (global level).

```yaml
name: Fallback chain
mode: on_error
runtimes:
  - runtime: claude
    model: sonnet
  - runtime: opencode
    model: openai/gpt-5
    reasoning_effort: high
```

- **`mode`**:
  - `on_error`: starts with the first enabled runtime and falls back to the next enabled runtime when an attempt hits limits or cannot start (`usage_limit`, `runtime_not_found`, `runtime_disabled`, `spawn`, `no_report`).
  - `random`: picks a random enabled runtime from the pool for each step.
  - `round_robin`: cycles through the enabled runtimes in order across steps.
- **`runtimes`**: a non-empty list of items. Each item defines `runtime` (`claude`, `opencode`, or `agy`), optional `model`, optional `enabled` (default `true`), and optional `variant` and `reasoning_effort` for OpenCode.
- **`enabled`**: optional boolean (default `true`). When a chain or all its runtimes are disabled, specialists bound to it use `defaults.runtime` with no explicit model.

A specialist binds to a chain via `runtime_chain: <slug>` in its definition (see [Specialists](specialists.md#fields)). The `runtime_chain` field cannot be used together with explicit `runtime`, `model`, `variant`, or `reasoning_effort`.

Connecting the hosts themselves is a separate matter: see [hosts/claude-code.md](../hosts/claude-code.md) and [hosts/opencode.md](../hosts/opencode.md).
