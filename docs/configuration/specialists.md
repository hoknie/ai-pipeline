# Specialists

A specialist is an agent role: a prompt, a model, a runtime and permissions. Every specialist is one file in `aip/specialists/` (see [File rules](README.md#file-rules)), and [workflows](workflows.md) name them in their steps.

The file `aip/specialists/plan.yaml` (the slug `plan` comes from the file name):

```yaml
name: Planner             # required
runtime: claude           # otherwise from defaults
model: opus               # passed to the runtime as is
permissions: read
timeout: 20m
allow_commands: ["npm test*"]
tools: [WebFetch]         # tools on top of the set for the permission level
skills: [grill-me, "review:pr"]
max: 1                    # at most one such specialist at a time
queue: false              # true: may add tasks to the queue (swarm_queue_add)
tags: [planning, review]  # labels for the panel; do not affect runs
prompt: |
  Write a plan: %s
```

## Fields

| Field | Meaning | Default |
|---|---|---|
| `name` | The display name. Required | |
| `prompt` | The instructions; see [Prompt](#prompt) | Only the task |
| `runtime` | `claude` or `opencode`; see [configuration/runtimes.md](runtimes.md) | [`defaults`](README.md#defaults) |
| `model` | `opus`, `sonnet` or a full id for Claude; `provider/model` for OpenCode | The runtime's default model |
| `permissions` | `read`, `edit` or `full`; see [configuration/permissions.md](permissions.md#permission-levels) | `defaults` |
| `timeout` | How long a step may run; a step that exceeds it gets `failed` | `defaults` |
| `allow_commands` | Command patterns allowed at the `edit` level | `defaults` |
| `tools` | Claude tools on top of the permission level; see [Tools](#tools) | `defaults` |
| `skills` | Skills to use; see [Skills](#skills) | None |
| `mcp` | MCP servers of this specialist; see [MCP servers](#mcp-servers) | `defaults` |
| `max` | How many may work at once; see [Limits](#limits) | No limit of its own |
| `queue` | May add tasks to the queue; see [Queueing tasks](#queueing-tasks) | `false` |
| `tags` | Labels for the panel; see [Tags](#tags) | None |

## Prompt

Every `%s` in `prompt` is replaced by the group's task, and `%%` gives a literal `%`. If there is no `%s`, the task is added as a separate paragraph. Without `prompt` the specialist gets only the task.

A step can narrow a specialist without a copy of it: see [`additional_prompt`](workflows.md#step-fields).

### What a specialist receives

The message to a specialist contains:

- its prompt with the task, and the step's `additional_prompt` if there is one;
- the summaries of the group's previous steps;
- the remarks of the specialist who rejected the work, after a return;
- the human's answer, after `needs_human`.

If the runtime can continue a session (Claude Code always, OpenCode by session id), the session continues after the human's answer.

## Limits

`max` is an integer from 1 to 32: how many specialists with this slug may work at once on the machine, across all runs. Several groups can plan at the same time while a single coder writes the code.

- Without the field only the [`max` of the repository](README.md#max) applies.
- The field is not inherited from `defaults`, and it does not interrupt specialists that are already working.
- The limit also applies to the task split, the commit message and the resolver.
- A group that needs a busy specialist does not hold back groups whose specialists are free.

A group that the scheduler does not start yet has the status `waiting`, with a reason in `wait`: see [Group statuses](../usage/runs.md#group-statuses).

## Skills

`skills` tells the specialist to use these skills. If a skill is not found in the runtime's directories (`.claude/skills`, `~/.claude/skills`, `~/.config/opencode/skills` and so on), a warning goes to the step log and the step still starts.

The panel suggests skills from these directories (`SKILL.md` in subdirectories, and command files `.md`, nested ones as `directory:command`) and marks whether each comes from the repository or the home directory.

## Tools

`tools` are Claude tools added to the set for the [permission level](permissions.md#tools-of-a-claude-specialist), for example `WebFetch`, `WebSearch` or `Task`. A value on a specialist replaces the value from `defaults`.

The panel suggests names from the catalog: Claude's built-in tools and the `mcp__<server>` servers from the repository's `.mcp.json` and `~/.claude.json`. A value that is not in the catalog is typed by hand.

## MCP servers

`mcp` starts MCP servers for this specialist only, next to the `aip` server, on the `claude` runtime. Other specialists do not get them; to give a specialist all your own servers, see [`claude.mcp`](runtimes.md#claudemcp).

```yaml
mcp:
  code-graph:
    command: /usr/local/bin/code-graph
    args: [--read-only]
```

- Each key is a server name: letters, digits, `-` and `_`; `aip` is reserved.
- `command` is required (a command name or an absolute path), `args` and `env` are optional.
- All tools of these servers run without a permission request.
- The values, `env` included, are stored in the run snapshot and in the `mcp.json` of the attempt, so pass secrets some other way.

## Queueing tasks

`queue: true` gives the specialist the MCP tool [`swarm_queue_add`](../hosts/mcp-tools.md#tools-of-a-specialist). The field cannot be set in `defaults`. For Claude the tool is allowed in advance at every permission level.

- The tool puts a task at the end of the queue of the run's repository, not of its own worktree. The queue does not start.
- Parameters: `workflow`, `task` or `groups`, an optional `title`, and `after`.
- `after` takes ids of queue items or runs that must be done first, for example ids returned by earlier `swarm_queue_add` calls. A specialist can queue a chain: a model first, then the API after it.
- The last step of a workflow can pass results on, for example by queueing a `feature` task for each prepared change.
- An unknown workflow, invalid parameters, or a call after the attempt has ended return an error to the specialist.
- The task gets [tags automatically](../usage/tags.md#tags-of-tasks-a-specialist-queues); a specialist cannot set them.

## Tags

`tags` are labels of the specialist for the filter and the import on the panel's [Specialists](../web/config.md#specialists) page. They do not change the specialist's configuration, prompt, permissions or the snapshot of a run. They are separate from the [tags of tasks and runs](../usage/tags.md).

- A name is trimmed, 1 to 30 characters, without a line break; repeats that differ only in case are merged.
- A value that is not a list of such names is an error at `swarm.specialists.<slug>.tags`.
- Tags of the shared file are shown in every project, read only on the "Specialists" page; they are changed only in the file itself.
- Tags of the project file are the project's own. A specialist defined on both levels shows both sets, although the project file replaces the other fields as a whole.
