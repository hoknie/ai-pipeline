# Permissions

Every [specialist](specialists.md) works at one permission level, set with `permissions`, and `allow_commands` lists the shell commands it may run. Start with `read` or `edit`, and widen them from what the run reports as denied.

## Permission levels

| Level | `claude` | `opencode` |
|---|---|---|
| `read` | tools `Read`, `Grep`, `Glob` | `edit: deny`, `bash: deny` |
| `edit` | editing files and `Bash(<pattern>)` for each command in `allow_commands` (or see [`claude.edit_mode`](#claudeedit_mode)) | `edit: allow`, `bash`: everything denied except `allow_commands` |
| `full` | `--dangerously-skip-permissions` | `--auto`, `bash: allow` |

`git push` is forbidden at every level, and `git checkout` and `git switch` are also forbidden at `read` and `edit`. The `full` level is enabled only explicitly, and `aip config check` warns about every specialist with `full`.

### Tools of a Claude specialist

A Claude specialist gets only the tools of its level.

- At `read`: `Read`, `Grep` and `Glob`.
- At `edit` and `full`, also `Edit`, `MultiEdit`, `Write`, `NotebookEdit` and `Bash`.
- If `skills` is set, `Skill` is added. [`tools`](specialists.md#tools) adds the ones listed.
- Other built-in Claude tools are not passed, because their descriptions would take up context on every turn.
- The `swarm_report` tool is loaded at once, without a tool search.

## `claude.edit_mode`

Sets how the `claude` runtime gets the `edit` level. The mode does not affect the `read` and `full` levels. `git push`, `git checkout` and `git switch` are forbidden in all modes.

- `allowlist` (the default) is an explicit list of tools: reading, searching, editing files, and the commands from `allow_commands`. Other shell commands are rejected.
- `accept_edits` is the Claude Code mode that accepts edits automatically. In it, file system commands such as `rm` and `mv` run even without `allow_commands`. Other shell commands still have to be listed in `allow_commands`.
- `auto` is the Claude Code `auto` mode: Claude Code's classifier judges every action.
  - Ordinary work (building, testing, reading, editing files) runs without patterns.
  - Anything the classifier considers risky (for example, sending files out) is rejected, and shows up as a permission denial of the attempt.
  - Commands from `allow_commands` are allowed in advance.
  - The classifier does not keep the specialist inside the worktree: it lets writes to the home directory through. That is why `auto` is not the default and `aip config check` warns about it.

## Denied commands

Commands that Claude Code rejected are shown in `aip group show` under the attempt (`denied: …`) and in the panel, each with a pattern for `allow_commands`. The `Permission hints:` line of a group collects the patterns that the specialists' permissions do not have yet:

```
     denied: Bash cd w && claude plugin test integrations/claude-code → claude plugin *
Permission hints: add to allow_commands: 'claude plugin *' (a retry or an answer picks them up)
```

- A compound command (`a && b`, `a | b`, `a; b`) passes only if every part matches a pattern, so a pattern is suggested for every part that is not allowed.
- Loops and here-documents cannot be allowed by a pattern; for them the output says `no pattern allows it` instead of a pattern.
- The `opencode` runtime does not report denials.

## Refreshing permissions

A run works from the configuration snapshot taken when it starts. On a retry or an answer (from the CLI, the panel or MCP) the specialist permissions are read again from the current `aip/` files, so you can add a pattern and continue.

- These are `permissions`, `allow_commands`, `tools`, `queue` and `claude.edit_mode`.
- The new permissions apply to all following steps of all groups of the run.
- Prompts, models, pipelines and other settings stay as in the snapshot. To take them too, see [Retry with the current configuration](../usage/runs.md#retry-with-the-current-configuration).
- If the configuration does not pass validation, the retry or the answer goes ahead with the old permissions, and the group gets the warning `permissions not refreshed: …`.

A hook in your own Claude Code settings can break `allow_commands` patterns: see [`claude.settings`](runtimes.md#claudesettings).
