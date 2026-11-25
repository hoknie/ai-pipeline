# Command reference

Every `aip` command, with a link to where its behaviour is described. `aip <command> --help` lists the options of a command.

## Runs

| Command | What it does |
|---|---|
| `aip run start <pipeline>` | [Queues a task](runs.md#starting-a-task) and starts a stopped queue; `--attach <path>` (repeatable) adds [attachments](queue.md#attachments) |
| `aip run list [run-id] [--tag <name>] [--mine\|--author <email>]` | Active and recent runs; with a run id, the table of that run's groups |
| `aip run show <run-id>` | The groups of one run and the `System:` line |
| `aip run lessons <run-id> [--json]` | [Lessons](runs.md#lessons-from-earlier-runs) a run leaves to later attempts of its repository, for every specialist |
| `aip run probe <run-id> [--harness <name>]` | [Starts a probe](runs.md#probes-of-another-harness) of the run on the same input in another harness; the probe is never delivered automatically |
| `aip run watch [run-id]` | Redraws the state of a run in place until it finishes |
| `aip run cancel <run-id>` | Stops a whole run |
| `aip run pause <run-id>` | [Pauses a run](queue.md#pausing-a-run) |
| `aip run variant <run-id> <variant> [--json]` | [Switches the variant](runs.md#changing-the-variant) of a run that is not finished; a running step whose definition changes starts again |
| `aip run provider <run-id> [id] [--none] [--json]` | [Switches the provider](runs.md#changing-the-provider) of a run that is not finished; a running step with a chain whose item changes starts again |
| `aip run skip <run-id> <step> [--off] [--json]` | [Skips a step](runs.md#skipping-a-step) for the whole run, or brings it back |
| `aip run apply <run-id> [group...] [--force]` | [Delivers](../configuration/delivery.md#automatic-and-manual-delivery) ready groups; with a server profile `[--mode worktree\|commit]` [applies the run's branch](../configuration/delivery.md#applying-on-your-machine) in your clone |
| `aip provider list [--json]` | [Providers](../configuration/providers.md) with the status `available`, `unavailable` or `disabled` and the roles they cover |
| `aip provider show <slug> [--json]` | One provider: routes, why a route is unavailable, the model of each role |
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
| `aip queue list [--mine\|--author <email>]` | Order, state and the reason for stopping |
| `aip queue add <pipeline>` | [Adds a task](queue.md#adding-and-ordering-tasks) without starting the queue; `--attach <path>` (repeatable) adds [attachments](queue.md#attachments) |
| `aip queue edit <item>`, `aip queue remove <item>` | Changes or removes a waiting task; `--attach <path>` and `--detach <name>` change its attachments |
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
| `aip repo list\|add <path>\|edit <project>\|move <project> <path>\|remove <project> [--json]` | The [projects](repositories.md#projects) the daemon knows (`SLUG`, `NAME`, `REPOSITORY`, `STATE`, `UNFINISHED`, `WAITING`, `QUEUED`); `<project>` is a path or a slug |

## Panels and streams

| Command | What it does |
|---|---|
| `aip overview [--json] [--watch]` | One summary of all projects: the daemon, what [needs you](runs.md#answering-a-specialist) (questions, failed or conflicting groups, failed or manual deliveries, stopped queues), the busy projects and the unfinished runs; `--watch` redraws it every second and cannot be combined with `--json` |
| `aip web`, `aip web start\|stop\|restart\|status` | The [web panel](../web/README.md) |
| `aip stats [--project <path>] [--since 30d] [--json]`, `aip stats clear --project <path>` | [Usage statistics](../configuration/stats.md): tokens and time per task, project, specialist, model, pipeline and runtime; `--since` is `<n>h`, `<n>d`, `<n>w` or `all`; `clear` deletes the records of a project |
| `aip events --json` | Streams changes as JSON lines: a snapshot first, then one line per change |

## Setup and maintenance

| Command | What it does |
|---|---|
| `aip setup` | [Connects](../getting-started/install.md#what-aip-setup-does) `aip` to Claude Code and OpenCode |
| `aip init [--shared]` | Creates a starter `aip/` [configuration](../configuration/README.md) |
| `aip config check` | [Validates](../configuration/README.md#checking-the-configuration) the configuration |
| `aip integration types\|list\|add\|edit\|enable\|disable\|remove`, `aip integration secret set\|remove` | [Connections](../configuration/integrations.md) to external systems and their secrets; a secret is passed with `--stdin`, never as an argument |
| `aip notify list\|add\|edit\|enable\|disable\|remove\|test\|log` | Subscriptions of projects to [notifications](notifications.md) in a chat: events, test message, journal of sending |
| `aip audit [--user <email>] [--repo <slug\|path>] [--action <prefix>] [--since <n>d] [--limit <n>] [--json]` | The [audit journal](../configuration/server.md#audit-journal) of the server, for administrators |
| `aip version [--json]` | The version, also printed by `aip --version`; with `--json`, `{"version":"…"}` on one line |
| `aip daemon …` | Controls the [daemon](daemon.md) |
| `aip mcp` | The [MCP server](../hosts/mcp-tools.md) over stdio, started by hosts |

## Colors

In a terminal the output is colored.

- A status icon comes before each state: `✓` done, `✗` error, `?` waiting for an answer, `▸` running, `◦` pending, `⊘` cancelled.
- `Steps:` of a run shows `✓ ▸ ◦ ⊘` after each step, and `Progress:` a bar of 10 cells (`█████░░░░░ 5/10 steps`). Without color the steps carry `[done]`, `[active]` and `[skipped]` marks and the bar is left out.
- `aip run show` and `aip run watch` end with dimmed `→` lines holding the next command: `aip group answer`, `aip group retry` or `aip run apply`. Without color there are none.
- Table headers are dimmed, `+N` is green and `−M` is red.
- In a colored terminal the tables fit the window width: long titles and notes are cut with `…` (the full text is in `aip run show` and `--json`), usage is short (`92.5k in / 77 out`), and `aip run list` hides the `REPOSITORY` column when all runs belong to one project. The width is read when the command starts; restart `aip run watch` after resizing the window.
- `--no-color` or the `NO_COLOR` variable turn colors off. `FORCE_COLOR=1` turns them on.
- In a pipe or a file the output has no colors, no icons, and nothing is cut or shortened. MCP tool texts and `--json` output are never colored.
