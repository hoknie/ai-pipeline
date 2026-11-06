# Command reference

Every `aip` command, with a link to where its behaviour is described. `aip <command> --help` lists the options of a command.

## Runs

| Command | What it does |
|---|---|
| `aip run start <pipeline>` | [Queues a task](runs.md#starting-a-task) and starts a stopped queue |
| `aip run list [run-id] [--tag <name>]` | Active and recent runs; with a run id, the table of that run's groups |
| `aip run show <run-id>` | The groups of one run and the `System:` line |
| `aip run watch [run-id]` | Refreshes the state of a run until it finishes |
| `aip run cancel <run-id>` | Stops a whole run |
| `aip run pause <run-id>` | [Pauses a run](queue.md#pausing-a-run) |
| `aip run skip <run-id> <step> [--off] [--json]` | [Skips a step](runs.md#skipping-a-step) for the whole run, or brings it back |
| `aip run apply <run-id> [group...] [--force]` | [Delivers](../configuration/delivery.md#automatic-and-manual-delivery) ready groups |
| `aip run mark-delivered <run-id> [--group <slug...>]` | Marks merged groups as delivered after you merged them by hand; nothing is applied |
| `aip run clean [run-id] [--all] [--json]` | [Cleans up](runs.md#cleaning-up) a finished run, or lists the ones that can be cleaned |
| `aip run tag <run-id> <name...>`, `aip run untag <run-id> <name...>` | Adds or removes [tags](tags.md) |

## Groups

| Command | What it does |
|---|---|
| `aip group show <run-id> <group>` | All step attempts of a group, verdicts, remarks, tokens, changed files with `+N −M`, and the tail of the log |
| `aip group answer <run-id> <group> <text>` | [Answers](runs.md#answering-a-specialist) a group in `needs_human` |
| `aip group retry <run-id> <group> [--refresh-config]` | [Retries](runs.md#retrying) a failed or cancelled step, or the merge after a conflict |
| `aip group cancel <run-id> <group>` | Stops a group |

## Queue

| Command | What it does |
|---|---|
| `aip queue list` | Order, state and the reason for stopping |
| `aip queue add <pipeline>` | [Adds a task](queue.md#adding-and-ordering-tasks) without starting the queue |
| `aip queue edit <item>`, `aip queue remove <item>` | Changes or removes a waiting task |
| `aip queue move <item> <position>` | Moves a waiting task; 1 is the first |
| `aip queue start`, `aip queue pause` | [Starts](queue.md#running-the-queue) the queue, or stops taking tasks |
| `aip queue parallel <n>` | Changes the number of simultaneous runs |
| `aip queue settings` | Changes the [queue settings](queue.md#queue-settings) |
| `aip queue run <item>` | Starts a task right now |
| `aip queue return <run-id>` | [Puts a run back](queue.md#returning-a-run) first in the queue |
| `aip queue dismiss <run-id>` | Removes a run from the skipped list |

## Tags and repositories

| Command | What it does |
|---|---|
| `aip tag list\|add\|edit\|remove` | The [tag catalog](tags.md) of a repository |
| `aip repo list\|add <path>\|remove <path> [--json]` | The [repositories](repositories.md) the daemon knows (`REPOSITORY`, `UNFINISHED`, `WAITING`, `QUEUED`) |

## Panels and streams

| Command | What it does |
|---|---|
| `aip web`, `aip web start\|stop\|restart\|status` | The [web panel](../web/README.md) |
| `aip events --json` | Streams changes as JSON lines: a snapshot first, then one line per change |

## Setup and maintenance

| Command | What it does |
|---|---|
| `aip setup` | [Connects](../getting-started/install.md#what-aip-setup-does) `aip` to Claude Code and OpenCode |
| `aip init [--shared]` | Creates a starter `aip/` [configuration](../configuration/README.md) |
| `aip config check` | [Validates](../configuration/README.md#checking-the-configuration) the configuration |
| `aip version [--json]` | The version, also printed by `aip --version`; with `--json`, `{"version":"…"}` on one line |
| `aip daemon …` | Controls the [daemon](daemon.md) |
| `aip mcp` | The [MCP server](../hosts/mcp-tools.md) over stdio, started by hosts |

## Colors

In a terminal the output is colored.

- A status icon comes before each state: `✓` done, `✗` error, `?` waiting for an answer, `▸` running, `◦` pending, `⊘` cancelled.
- Table headers are dimmed, `+N` is green and `−M` is red.
- `--no-color` or the `NO_COLOR` variable turn colors off. `FORCE_COLOR=1` turns them on.
- In a pipe or a file the output has no colors and no icons. MCP tool texts and `--json` output are never colored.
