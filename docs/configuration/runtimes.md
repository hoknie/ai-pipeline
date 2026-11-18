# Runtimes

A runtime is the agent CLI that executes a step: `claude` (Claude Code), `opencode`, `agy` (Antigravity CLI), or one of four CLIs that can talk to your own LLM endpoint: `codex` (Codex CLI), `kilo` (Kilo Code CLI), `cline` (Cline CLI) and `copilot` (GitHub Copilot CLI).
A specialist picks one with [`runtime`](specialists.md#fields). This page covers how `aip` finds and starts it, and what a specialist inherits from your own setup.

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
  codex:
    enabled: true
    env: { AIP_CODEX_BASE_URL: "https://llm.example/v1", AIP_CODEX_API_KEY: "sk-..." }
```

This section is set in the shared `settings.yaml` only. In a project `aip/settings.yaml` it is a validation error (`swarm.runtimes`).

- **`enabled`** switches the runtime on or off. Every runtime is off until you switch it on: without the field, `aip` does not start it. A step of a specialist on a runtime that is off fails with `runtime disabled: <name>` (a chain with `on_error` moves on to its next item), the request for a run name is skipped and the list of its models stays empty.
  - [Observers](../usage/runs.md#observers) do not repair such a failure and do not start a repair on a runtime that is off.
  - A non-empty `AIP_<NAME>_BIN` (`AIP_CLAUDE_BIN`, `AIP_OPENCODE_BIN`, `AIP_AGY_BIN`, `AIP_CODEX_BIN`, `AIP_KILO_BIN`, `AIP_CLINE_BIN`, `AIP_COPILOT_BIN`) in the daemon's environment switches the runtime on while `enabled` is not set. An explicit `enabled: false` wins over the variable.
  - Switch it in the panel (Settings → Runtimes → <runtime> → Enabled) or set `runtimes.<name>.enabled: true` in the shared `settings.yaml`. To go back to an older `aip`, remove `enabled` from the file first.
- **`command`** is the agent CLI to start: a name looked up in `PATH`, or an absolute path (`~` is not expanded; a relative path with `/` is an error). The default is the runtime's name.
  - The order of choice is: `AIP_<NAME>_BIN` from the daemon's environment, then `command`, then `PATH`.
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
- Token usage on a resumed conversation is cumulative, so only usage attributable to the current attempt is counted.
- `aip` applies its own permission check to file writes and commands. A shell command is denied unless it matches `allow_commands`; commands with uninspectable shell syntax are denied.
- `variant` and `reasoning_effort` are OpenCode-only and cannot be used with agy.

## CLIs with your own LLM endpoint

`codex`, `kilo`, `cline` and `copilot` start only when you switch them on (`enabled: true` or `AIP_<NAME>_BIN`); none of them is a default.

**Experimental.** These four runtimes are tested against fake CLIs only, not against the live ones.
What may differ in a real CLI: for `codex`, `kilo` and `cline` the endpoint handling, the permission settings and the resume of a conversation; for `copilot` the JSONL stream and the session id, the hooks read from `COPILOT_HOME`, and the specialist MCP servers.
Try one on a throwaway profile and repository before you rely on it.

Each keeps its conversation in a private folder of the group in the workspace (`logs/<run>/<group>/conversations/`), outside the worktree and apart from your own profile of the CLI.
A resume after a human answer, a pause or a restart of the daemon continues the same conversation with the exact id the CLI reported; a retry starts an empty one, and a fall back to another runtime in a [chain](#runtime-chains) never carries the id or the folder over.
The folder of a step is removed when the step ends with `done` or `rejected` (a step waiting for review keeps it) and with the merged group. Every attempt gets a new worker server and a new token, and the registration of the earlier one is replaced before the CLI starts.

The endpoint is set in the environment of the CLI, in the shared `settings.yaml` (`runtimes.<name>.env`) or in the environment of the daemon. The panel shows the names of the variables, never their values.
A key is passed to the CLI as the name of a variable, not in an argument or a file of the attempt; a CLI may still print a key it is given in its own raw error output, which `aip` does not filter.

| Runtime | Endpoint | Protocol | Models |
|---|---|---|---|
| `codex` | `AIP_CODEX_BASE_URL`, key in `AIP_CODEX_API_KEY` or the variable named in `AIP_CODEX_API_KEY_ENV` | Responses API only; an endpoint that answers Chat Completions is refused | typed by hand |
| `kilo` | `AIP_KILO_BASE_URL`, key as above with `AIP_KILO_` | OpenAI-compatible; the config of the private home holds `{env:KEY}` | typed by hand; `provider/model`, or a bare name for your endpoint |
| `cline` | `AIP_CLINE_BASE_URL`, key as above with `AIP_CLINE_` | OpenAI-compatible | typed by hand |
| `copilot` | `COPILOT_PROVIDER_BASE_URL`, `COPILOT_PROVIDER_TYPE`, `COPILOT_PROVIDER_API_KEY` | the provider types of the CLI; the model must stream and call tools | `model` of the specialist (`COPILOT_MODEL`) |

Without an endpoint the CLI uses its own login (`codex`: `CODEX_API_KEY`). The endpoint has to support streaming and tool calls; a name that only looks OpenAI-compatible is not enough. The list of models is empty and a model typed by hand stays valid: no CLI of these four has a documented command to list the models of a custom endpoint.

- **Permissions** are enforced by the generated configuration of every attempt, see [Permissions](permissions.md#clis-with-your-own-llm-endpoint). `copilot` does not start without a pre-tool gate and an OS sandbox.
- **Skills**: `.codex/skills`, `.kilo/skills`, `.cline/skills`, and `.github/skills` with `~/.copilot/skills`.
- `variant` and `reasoning_effort` are OpenCode-only.
- **Ready for use only after a manual check.** The generated settings follow the documentation of each CLI. Each of them has to be checked once on a disposable profile of the installed version (endpoint, worker, permissions, cancel, resume by id) before you rely on it.
- **Not runtimes**: Cursor CLI (its key signs in to Cursor; no documented own model endpoint), Gemini CLI (only the documented Gemini and Vertex routes), the IDE extensions of Kilo, Cursor, Cline and Copilot, and `agy` for this purpose (no documented base URL of the model).
GLM Coding Plan is a subscription and provider, not an agent: use it through a CLI above with the key and the protocol its documentation names for that client.

## `claude.mcp`

- `isolated` (the default): the `claude` specialist sees only the `aip` server, with none of the MCP servers from your Claude Code settings.
- `inherit`: the specialist can use your servers too.

To give servers to specialists without your whole Claude Code setup, use the [`mcp_servers` catalog and `mcp`](specialists.md#mcp-servers).

## `opencode.mcp`

`inherit` (the default) retains the user's and project's OpenCode MCP servers.
`isolated` disables servers found in global `opencode.json`/`opencode.jsonc` and project
`opencode.json`/`opencode.jsonc` and `.opencode/opencode.json`/`opencode.jsonc`, while retaining the worker and specialist servers.
Sources outside these files, such as organization configuration, are not covered.
An unreadable or invalid file makes the attempt fail rather than silently losing isolation.

## `agy.mcp`

`isolated` (the default) allows only the attempt's worker and specialist MCP servers. `inherit` also allows user MCP servers, but never the worker of another attempt.

## Runtime `overrides`

`claude.overrides`, `opencode.overrides` and `agy.overrides` accept a JSON-compatible object at either settings level. The project object replaces the global object. Values are stored in the run snapshot; `${VAR}` is not expanded here, so put secrets in `runtimes.<runtime>.env`. The one-off run-title request does not receive overrides.

Claude overrides go to the attempt's `--settings` file, OpenCode overrides to its generated `opencode.json`, and agy overrides to its `settings.json`.
aip's generated settings win, and its permission and worker MCP nodes replace user nodes entirely.
Claude rejects `permissions`, `hooks`, `enableAllProjectMcpServers`, `enabledMcpjsonServers`, and `disabledMcpjsonServers`;
OpenCode rejects `agent.aip-*` and `mcp.aip`.
agy allows keys in the object but aip replaces its own permission and mode settings and the guard still checks every call.
OpenCode's other permission keys can be inherited from user configuration; overrides have the same limitation.

There is no `opencode.settings` or `agy.settings`: OpenCode has no reliable switch for personal settings without losing authentication and providers, while agy already uses an attempt settings file and aip's guard.

## MCP servers of a specialist

The servers of a specialist (the [catalog](specialists.md#mcp-servers) and `mcp`) work on all runtimes:

- `claude`: they go into the `mcp.json` of the attempt next to `aip`.
- `opencode`: they go into the generated `opencode.json` under `mcp`, as local servers.
- `agy`: they go into `.agents/mcp_config.json` of the attempt. The specialist sees a server under the name `aip-<session>-<name>` (for example `aip-3f9c-graph`), which changes from attempt to attempt; its tools and their descriptions are the same. Only the servers of this attempt are allowed, not other servers you have.

`${NAME}` in `env` and `args` is replaced when the attempt starts, and the files of the attempt are readable by you only.

## `claude.settings`

- `isolated` (the default): the `claude` specialist starts without your user-level Claude Code settings (`~/.claude/settings.json`).
  - Your hooks, plugins and permission rules do not apply to it. A hook that rewrites shell commands (for example, `npm run check` into `rtk npm run check`) cannot break the `allow_commands` patterns.
  - The project settings (`.claude/settings.json` and `.claude/settings.local.json` in the repository) and the project's instructions still apply. Your Claude Code login is not affected.
- `inherit`: the specialist reads your settings as well. Use it if the specialist needs `env` or `apiKeyHelper` from `~/.claude/settings.json`.

The one-off call that makes up a run title always goes without your settings.

## `claude.edit_mode`

How the `claude` runtime gets the `edit` level is described in [configuration/permissions.md](permissions.md#claudeedit_mode).

## What differs between runtimes

| | `claude` | `opencode` | `agy` | `codex`, `kilo`, `cline`, `copilot` |
|---|---|---|---|---|
| Continuing a session | Always | By session id | By `conversation_id` | By id from the private state of the conversation |
| Reporting denied commands | Yes | No, see [Denied commands](permissions.md#denied-commands) | Shown in the journal | No |
| Recognizing a [usage limit](../usage/queue.md#usage-limit) | Yes | No | No | No |
| [`tools`](specialists.md#tools) of a specialist | Yes | No | No | No |
| [MCP servers](specialists.md#mcp-servers) of a specialist | Yes | Yes | Yes, under other names: see [MCP servers of a specialist](#mcp-servers-of-a-specialist) | Yes, under the name of the attempt's worker plus `-<name>` |

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
  - `by_provider`: a tier, see [Tiers](#tiers-by_provider).
- **`runtimes`**: a non-empty list of items. Each item defines `runtime` (`claude`, `opencode`, `agy`, `codex`, `kilo`, `cline` or `copilot`), optional `model`, optional `enabled` (default `true`), optional `provider` (the slug of a [provider](providers.md); it must exist, a disabled one is allowed), and optional `variant` and `reasoning_effort` for OpenCode.
- **`enabled`**: optional boolean (default `true`). When a chain or all its runtimes are disabled, specialists bound to it use `defaults.runtime` with no explicit model.

A specialist binds to a chain via `runtime_chain: <slug>` in its definition (see [Specialists](specialists.md#fields)). The `runtime_chain` field cannot be used together with explicit `runtime`, `model`, `variant`, or `reasoning_effort`.

### Tiers (`by_provider`)

A tier is a chain with `mode: by_provider` that gives each provider its own runtime and model, for a role such as thinking, coding or ultralight. Every item names its `provider`, which must be defined in [`providers/`](providers.md), and the providers of one tier are unique, disabled items included. At most one item may be `default: true`; `default` is allowed in tiers only.

```yaml
name: Thinking
mode: by_provider
runtimes:
  - provider: anthropic
    runtime: claude
    model: opus
  - provider: zai
    runtime: opencode
    model: zai/glm-5.3
  - provider: openai
    runtime: opencode
    model: openai/gpt-6.1-sol
```

A specialist uses a tier through `runtime_chain: thinking`. Until a step asks for a provider, a tier takes the first available item in file order, and the next one after a failure: the `on_error` rule. `default` does not change that order. A session that continues stays on the item it started on.

A task can ask for a provider (`--provider zai`, see [Provider](../usage/queue.md#provider)). Its steps on a tier then use the item of that provider, or the `default` item (else the first enabled one) when the tier has none. The tier never switches to another provider for such a task, neither after a failure nor at a usage limit.

### Usage limit and providers

A [usage limit](../usage/queue.md#usage-limit) holds the provider of the attempt when its chain item has a `provider` (also in chains of other modes), and the runtime otherwise. A held provider does not stop other providers on the same runtime, while a limit of a runtime without a provider holds every item of that runtime.

The wait of a group and the stop of the queue then name the provider, for example `zai (Z.ai, opencode)`. Use one provider id for one account: two ids for the same account do not share a limit.

Connecting the hosts themselves is a separate matter: see [hosts/claude-code.md](../hosts/claude-code.md) and [hosts/opencode.md](../hosts/opencode.md).
