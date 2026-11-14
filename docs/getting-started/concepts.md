# How aip works

`aip` is a local orchestrator. A background daemon takes tasks from a queue and runs AI agents on them, each in its own copy of your repository, and hands you the merged result. Nothing is pushed, and nothing is committed unless you ask for it.

## Terms

| Term | What it is | Read more |
|---|---|---|
| Specialist | An agent role: a prompt, a model, a runtime and permissions. One file in `aip/specialists/` | [configuration/specialists.md](../configuration/specialists.md) |
| Pipeline | The order of work: steps, returns on rejection, an optional split. One file in `aip/pipelines/`. The web panel calls it a "Pipeline" | [configuration/pipelines.md](../configuration/pipelines.md) |
| Task | What you ask for: text, or a list of groups. A task waits in the queue | [usage/queue.md](../usage/queue.md) |
| Run | A task taken from the queue and being worked on, with a snapshot of the configuration | [usage/runs.md](../usage/runs.md) |
| Group | An independent part of a run with its own git worktree. A run has one group or many | [configuration/pipelines.md](../configuration/pipelines.md#split) |
| Step | One specialist working on one group. A step ends with a verdict | [configuration/pipelines.md](../configuration/pipelines.md#verdicts) |
| Attempt | One start of a step. A return, a retry or an answer makes a new attempt | [usage/runs.md](../usage/runs.md#following-a-run) |
| Delivery | Bringing the merged result of a run to you | [configuration/delivery.md](../configuration/delivery.md) |
| Runtime | The agent CLI that executes a step: `claude` or `opencode` | [configuration/runtimes.md](../configuration/runtimes.md) |
| Host | Where you control `aip` from: Claude Code, OpenCode, the terminal, the web panel | [hosts/mcp-tools.md](../hosts/mcp-tools.md) |
| Daemon | The background process that owns all state | [usage/daemon.md](../usage/daemon.md) |

## The life of a task

1. **Queue.** `aip run start`, `aip queue add`, an MCP tool, a specialist or the web panel puts a task in the queue of the repository.
2. **Start.** A task may carry [attachments](../usage/queue.md#attachments); they go with it into the run and specialists read them. When a place is free, the queue turns the task into a run. The run takes a snapshot of the configuration and of your working tree (see [`workspace`](../configuration/README.md#workspace)).
3. **Split.** If the pipeline has a [`split`](../configuration/pipelines.md#split), a specialist divides the task into groups. Otherwise the task is one group.
4. **Steps.** Each group goes through the steps in order, in its own worktree. Groups of a run work in parallel, within [`max`](../configuration/README.md#max). Every step ends with `swarm_report`, and its changes are committed inside the run.
5. **Returns and questions.** A rejection returns the group to an earlier step with the remarks. A question stops the group until [you answer](../usage/runs.md#answering-a-specialist); `aip overview` lists everything that waits for you across all projects.
6. **Merge.** A group that passed its last step is merged inside the run.
7. **Delivery.** The merged result reaches your repository as uncommitted changes, one commit or a branch. See [configuration/delivery.md](../configuration/delivery.md).
8. **Cleanup.** The worktrees and internal refs are removed; logs and history stay.

## What stays untouched

While the swarm works, your branch, index and working tree stay untouched, and no extra branches appear: step commits and group merges live in internal refs. Only delivery changes your repository, and it merges the result with your uncommitted edits.

Specialists work in worktrees under `.aip/`. They get only the [permissions](../configuration/permissions.md) you give them; `git push` is forbidden at every level.

## Who talks to whom

The daemon starts by itself on the first request, and one daemon serves all your [repositories](../usage/repositories.md). The CLI, `aip mcp` and the web panel are clients of it, so they all show one state. A specialist reports back through its own MCP server, started for each attempt with [its own tools](../hosts/mcp-tools.md#tools-of-a-specialist).
