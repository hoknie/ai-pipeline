# Permissions

Every [specialist](specialists.md) works at one permission level, set with `permissions`, and `allow_commands` lists the shell commands it may run. Start with `read` or `edit`, and widen them from what the run reports as denied.

## Permission levels

| Level | `claude` | `opencode` | `agy` |
|---|---|---|---|
| `read` | tools `Read`, `Grep`, `Glob` | `edit: deny`, `bash: deny` | Read/search tools only; writes and shell denied |
| `edit` | editing files and `Bash(<pattern>)` for each command in `allow_commands` (or see [`claude.edit_mode`](#claudeedit_mode)) | `edit: allow`, `bash`: everything denied except `allow_commands` | Worktree edits and commands verified against `allow_commands` |
| `full` | `--dangerously-skip-permissions` | `--auto`, `bash: allow` | Editing and shell allowed, except protected Git operations |

The levels of `codex`, `kilo`, `cline` and `copilot` are in [CLIs with your own LLM endpoint](#clis-with-your-own-llm-endpoint).

`git push` is forbidden at every level, and `git checkout` and `git switch` are also forbidden at `read` and `edit`. The `full` level is enabled only explicitly, and `aip config check` warns about every specialist with `full`.

### Tools of a Claude specialist

A Claude specialist gets only the tools of its level.

- At `read`: `Read`, `Grep` and `Glob`.
- At `edit` and `full`, also `Edit`, `MultiEdit`, `Write`, `NotebookEdit` and `Bash`.
- If `skills` is set, `Skill` is added. [`tools`](specialists.md#tools) adds the ones listed.
- Other built-in Claude tools are not passed, because their descriptions would take up context on every turn.
- The `swarm_report` tool is loaded at once, without a tool search.

### Attachments of a task

A run with [attachments](../usage/queue.md#attachments) gives every specialist the right to read the folder `logs/<run id>/_attachments/` of the workspace, at every level and for every runtime: `--add-dir` and a `Read` rule for `claude`, `external_directory` for `opencode`, `--add-dir` and an allowed read path for `agy`. Writing outside the worktree stays forbidden.

The folder is laid out again from the stored copy before every attempt, so a changed file does not survive.

## `claude.edit_mode`

Sets how the `claude` runtime gets the `edit` level. The mode does not affect the `read` and `full` levels. `git push`, `git checkout` and `git switch` are forbidden in all modes.

- `allowlist` (the default) is an explicit list of tools: reading, searching, editing files, and the commands from `allow_commands`. Other shell commands are rejected.
- `accept_edits` is the Claude Code mode that accepts edits automatically. In it, file system commands such as `rm` and `mv` run even without `allow_commands`. Other shell commands still have to be listed in `allow_commands`.
- `auto` is the Claude Code `auto` mode: Claude Code's classifier judges every action.
  - Ordinary work (building, testing, reading, editing files) runs without patterns.
  - Anything the classifier considers risky (for example, sending files out) is rejected, and shows up as a permission denial of the attempt.
  - Commands from `allow_commands` are allowed in advance.
  - The classifier does not keep the specialist inside the worktree: it lets writes to the home directory through. That is why `auto` is not the default and `aip config check` warns about it.

### Antigravity CLI (`agy`)

Antigravity runs headlessly with a permission hook scoped to the current attempt. Its user-level `permissions` may add restrictions; they do not grant a specialist more access than `aip` assigned.

In `edit`, `allow_commands` is checked against the whole command: `npm test` does not authorize `npm test -- --update`, while `npm test*` does. Shell substitutions, redirections and commands the hook cannot inspect are denied. Writes are limited to the worktree. `agy` does not return permission denials in the same structured form as Claude Code.

### CLIs with your own LLM endpoint

These CLIs are experimental: their permission settings are tested against fake CLIs, not against the live ones, so check them on a throwaway repository first.
For these CLIs `aip` writes the permissions into the private configuration of every attempt; the instructions in the prompt are not a boundary and the CLI's own auto-approve mode never replaces them.
Only the worker of the attempt, by exact name and only its tools (`swarm_report` and the others the step may use), and the MCP servers of the specialist are allowed; the servers of your profile, of other specialists and of earlier attempts are refused, and a server whose name merely starts with an allowed name is another server.
Any action that is not listed is refused instead of asking a person.

- `codex`: sandbox `read-only`, `workspace-write` (no network) or `danger-full-access`; at `edit` the approval policy `untrusted` and an execution rule for each prefix of `allow_commands` (a rule matches the start of the command, not the whole line); `git push`, `git checkout` and `git switch` are forbidden by rules at every level.
- `kilo`: a rule set with `*: deny` first, then the read tools, `edit`, the commands of the level and the exact tools of the worker. The deny rules for the protected Git commands stay in force under `--auto` at `full`.
- `cline`: a `PreToolUse` hook of the private profile decides every action: the whole command against `allow_commands`, the canonical path inside the worktree (links and `..` resolved), the exact MCP server and tool. A hook that fails refuses the action.
- `copilot`: a pre-tool hook decides every shell, file and MCP action like the one of `cline`, and the CLI with all its children runs in an OS sandbox (Seatbelt on macOS, bubblewrap on Linux).
Outside the private state of its conversation the sandbox writes only the worktree, and only at `edit` and `full`; the other conversations are hidden. Without the sandbox program or the hook `copilot` does not start. `--trust-folder` and `--continue` are never used.

In `edit`, `allow_commands` of `cline` and `copilot` is checked against the whole command like for `agy`: a chain runs only when every command in it is allowed.

## Denied commands

Commands that Claude Code rejected are shown in `aip group show` under the attempt (`denied: …`) and in the panel, each with a pattern for `allow_commands`. The `Permission hints:` line of a group collects the patterns that the specialists' permissions do not have yet:

```
     denied: Bash cd w && claude plugin test integrations/claude-code → claude plugin *
Permission hints: add to allow_commands: 'claude plugin *' (a retry or an answer picks them up)
```

- A compound command (`a && b`, `a | b`, `a; b`) passes only if every part matches a pattern, so a pattern is suggested for every part that is not allowed.
- Loops and here-documents cannot be allowed by a pattern; for them the output says `no pattern allows it` instead of a pattern.
- The `opencode` runtime does not report denials.
- Antigravity permission-hook denials are shown in its journal; the hook refuses unverified actions rather than widening a command prefix.

## Refreshing permissions

A run works from the configuration snapshot taken when it starts. On a retry or an answer (from the CLI, the panel or MCP) the specialist permissions are read again from the current `aip/` files, so you can add a pattern and continue.

- These are `permissions`, `allow_commands`, `tools`, `queue` and `claude.edit_mode`.
- The new permissions apply to all following steps of all groups of the run.
- Prompts, models, pipelines and other settings stay as in the snapshot. To take them too, see [Retry with the current configuration](../usage/runs.md#retry-with-the-current-configuration).
- If the configuration does not pass validation, the retry or the answer goes ahead with the old permissions, and the group gets the warning `permissions not refreshed: …`.

A hook in your own Claude Code settings can break `allow_commands` patterns: see [`claude.settings`](runtimes.md#claudesettings).
