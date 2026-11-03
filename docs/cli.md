# Command reference

The commands you use every day, and the daemon. For installation see [install.md](install.md), for the configuration files see [configuration.md](configuration.md), for Claude Code and OpenCode see [hosts.md](hosts.md).

## Starting a task and getting the result

```sh
aip run start feature --task "Add a login form"
aip run watch
```

- `aip run start` puts the task at the end of the repository's queue and starts the queue if it is stopped. Tasks from `swarm_run` and `/aip:run` go through the queue too.
- A run is created when the queue takes the task. If all places are taken, the command prints the position in the queue and "N of M places taken", and the task starts when a place frees up.
- To pass several independent tasks, use a file with a list of `{ title, task }` entries: `aip run start feature --groups groups.yaml`.
- `--auto-deliver`, `--no-auto-deliver` and `--delivery-mode worktree|commit|branch` set delivery for one run (see [`delivery`](configuration.md#delivery)).
- A run gets a short title and an English name on its own (see `naming` in [configuration.md](configuration.md#naming)). `--title` sets the title yourself.
- The queue, `--skip` and `--after` are in [queue.md](queue.md).

A run starts from a snapshot of your working tree, so specialists also see your uncommitted edits. While the swarm works, your branch, index and working tree stay untouched, and no extra branches appear.

When the run is finished, its changes land in your working tree as uncommitted changes. With `delivery: { auto: false }`, run `aip run apply` yourself:

```sh
aip run show <run-id>
aip group show <run-id> <group>
aip run apply <run-id>            # all ready groups; or: aip run apply <run-id> login signup
git diff                          # review and commit it yourself
```

- `aip run show` prints a `System:` line with the system stages in the order split, commit message, resolver and delivery, for example `System: split done · message running · delivery pending`. A failed delivery shows its first reason there, even when no resolver ran.
- A group that waits for a free specialist or place has the status `waiting`, and the `NOTE` column says what it waits for, for example `waiting for coder`. The `Groups:` line counts them as `waiting N`.
- The changes are merged with your uncommitted edits. Conflicts, the resolver and `--force` are described in [`delivery`](configuration.md#delivery).
- The `delivery` section switches to one commit, to a branch, or to manual delivery. The `workspace` section sets the base of a run and the paths that git ignores.

## Commands

| Command | What it does |
|---|---|
| `aip run list [run-id]` | Active and recent runs, each with its task number (`#` column), with the first line of its task and a summary of changes (`2 files +367 −0`); with a run id, the table of that run's groups |
| `aip group show <run-id> <group>` | All step attempts of a group, verdicts, remarks, tokens, changed files with `+N −M`, and the tail of the log |
| `aip run watch [run-id]` | Refreshes the state of a run until it finishes |
| `aip queue …`, `aip tag …` | The task queue and tags: see [queue.md](queue.md) |
| `aip web …` | The web panel: see [web.md](web.md) |
| `aip repo list\|add <path>\|remove <path> [--json]` | Lists the repositories the daemon knows (`REPOSITORY`, `UNFINISHED`, `WAITING`, `QUEUED`). `add` finds the git root from a subdirectory. `remove` refuses while the repository has unfinished runs or queued tasks |
| `aip group answer <run-id> <group> <text>` | Answers a specialist's question (a group in `needs_human`) |
| `aip group retry <run-id> <group>` | Retries a failed or cancelled step from where it stopped, or retries the merge after a conflict |
| `aip run cancel <run-id>` / `aip group cancel <run-id> <group>` | Stops a whole run or a group |
| `aip run skip <run-id> <step> [--off] [--json]` | Skips a step that is running or still ahead for the whole run, or brings it back with `--off`. A running step is stopped without a commit; its partial changes stay uncommitted in the group worktree. A step every group has passed cannot be skipped |
| `aip run apply <run-id> [group...] [--force]` | Delivers ready groups to the working tree (or as a commit, or as a branch) |
| `aip run clean [run-id] [--all] [--json]` | Without an id, lists finished runs that can be cleaned up (id, title, finish time) and suggests `aip run clean <run-id>`; `--json` prints the list as JSON. With an id, removes the worktrees and internal refs of a finished run. This happens automatically after delivery |
| `aip version [--json]` | The aip version, also printed by `aip --version`; with `--json`, `{"version":"…"}` on one line |

## Task queue

The queue and tags are described in [queue.md](queue.md).

## Colors

In a terminal the output is colored.

- A status icon comes before each state: `✓` done, `✗` error, `?` waiting for an answer, `▸` running, `◦` pending, `⊘` cancelled.
- Table headers are dimmed, `+N` is green and `−M` is red.
- `--no-color` or the `NO_COLOR` variable turn colors off. `FORCE_COLOR=1` turns them on.
- In a pipe or a file the output has no colors and no icons. MCP tool texts and `--json` output are never colored.

## Daemon

The daemon starts automatically on the first request. To control the background daemon by hand:

```sh
aip daemon start          # does nothing if it runs
aip daemon stop
aip daemon restart [--force] [--web]
aip daemon status [--json]
```

- `stop` and `restart` refuse with code 1 while agents work or a merge runs. `--force` stops the daemon together with its agents, and their steps become `failed` with the reason `interrupted` at the next start.
- `restart --web` also raises the web panel of the new daemon, even with `web.autostart: false`, and prints `aip web: <url>`. If the panel cannot start (a busy port, an error in the `web` section), the reason goes to stderr, the exit code is 1 and the daemon keeps running.
- `status` starts and stops nothing. It exits with code 3 when no daemon runs.
- Bare `aip daemon` runs the daemon in the foreground.

### Replacing an old build

The daemon and its clients (the CLI, `aip mcp`, `aip web`) compare builds. A build is the version of `aip` together with its code. A rebuild without a version bump is a different build.

- If the daemon is older than the client and nothing is working or merging, the client stops it and starts a daemon of its own build. Runs, queues and answers are kept in the database.
- If agents are working, the daemon keeps going and the client writes a warning to stderr. The next `aip` command after the agents finish restarts the daemon. To replace it at once, run `aip daemon restart --force`, which stops running agents.
- `aip web` checks the daemon every 30 seconds and shows the warning as a banner above the page.
- If the daemon is newer than the client, the daemon is left alone and the client asks you to restart itself.
- A daemon from a build without this check is never stopped automatically. The client only reports its pid.

## Where files live

- `~/.config/aip/` holds the shared configuration (`settings.yaml`, `specialists/`, `workflows/`); `aip/` in a repository takes precedence.
- `<repository>/.aip/` holds the group worktrees and step logs. The directory is added to `.git/info/exclude`; set another location with `workspace_dir`.
- `~/.local/state/aip/` (or `$XDG_STATE_HOME/aip/`) holds the state database, the socket and the daemon log.
- Several repositories on one daemon: see [Multiple repositories](hosts.md#multiple-repositories).
