# aip

`aip` is a local orchestrator for a swarm of AI agents. You describe the specialists (planner, coder, reviewer, QA…) and the order they work in under an `aip/` configuration directory. `aip` starts the specialists in Claude Code or OpenCode, keeps at most `max` of them running at once, gives every group of work its own git worktree, and, on your command, puts the final diff into your working tree as uncommitted changes, as one commit or as a branch. You can follow and control the work from Claude Code, OpenCode and the terminal.

## Requirements

- Node.js 24 or newer;
- git 2.20 or newer;
- `claude` (Claude Code) and/or `opencode` in `PATH`, depending on which runtimes `aip/` uses.

## Installation

```sh
npm install
npm run build
npm link            # makes the aip command available in PATH
aip --version
```

## First run

1. Put an `aip/` directory in the root of the repository the swarm will work on. Settings go in `aip/settings.yaml`:

   ```yaml
   max: 2
   defaults:
     allow_commands: ["npm test*"]
   ```

   Add one file per specialist: `aip/specialists/coder.yaml` (`name: Coder`) and `aip/specialists/reviewer.yaml` (`name: Reviewer` and `permissions: read`). Add one file per workflow, `aip/workflows/feature.yaml`:

   ```yaml
   steps:
     - { id: code, specialist: coder }
     - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 2 } }
   ```

   The `examples/aip/` directory has a complete example, and `docs/configuration.md` describes every field.

2. Check the configuration and that the agent CLIs are installed:

   ```sh
   aip config check
   ```

3. Start a task and watch it:

   ```sh
   aip run start feature --task "Add a login form"
   aip run watch
   ```

   `aip run start` puts the task at the end of the repository's queue and starts the queue if it is stopped. A run is created when the queue takes the task. If all places are taken, the command prints the position in the queue and "N of M places taken", and the task starts when a place frees up. Tasks from `swarm_run` and `/aip:run` follow the same path.

   To pass several independent tasks, use a file with a list of `{ title, task }` entries: `aip run start feature --groups groups.yaml`. The flags `--auto-deliver` and `--no-auto-deliver` override auto-delivery for one run (by default `delivery.auto` applies). A run gets a short title and an English name on its own (see `naming` in `docs/configuration.md`); you can set the title yourself with `--title`.

4. Look at the result. A run starts from a snapshot of your working tree, so specialists also see your uncommitted edits. While the swarm works, your branch, index and working tree stay untouched, and no extra branches appear. When the run is finished, its changes land in your working tree as uncommitted changes on their own. With `delivery: { auto: false }`, run `aip run apply` yourself:

   ```sh
   aip run show <run-id>
   aip group show <run-id> <group>
   aip run apply <run-id>            # all ready groups; or: aip run apply <run-id> login signup
   git diff                          # review and commit it yourself
   ```

   The changes are merged with your uncommitted edits. If they conflict, the specialist named in `delivery.resolver` resolves the conflict. Without one, delivery changes nothing and lists the files. `aip run apply --force` applies the changes and leaves the conflict markers in place. The `delivery` section switches to one commit instead of uncommitted changes, to a branch, or to manual delivery. The `workspace` section sets the base of a run and the paths that git ignores (see `docs/configuration.md`).

## Commands

| Command | What it does |
|---|---|
| `aip run list [run-id]` | Active and recent runs, each with the first line of its task and a summary of changes (`2 files +367 −0`); with a run id, the table of that run's groups |
| `aip group show <run-id> <group>` | All step attempts of a group, verdicts, remarks, tokens, changed files with `+N −M`, and the tail of the log |
| `aip run watch [run-id]` | Refreshes the state of a run until it finishes |
| `aip web [--port 7341] [--open]` | A local web panel. It has a repository picker and a sidebar ("Runs", "Queue", "Topology", "Specialists", "Workflow"), a light and a dark theme, a `Cmd/Ctrl+K` command palette, and an interface in English, Spanish, Russian and Chinese (chosen by the browser language, changeable in the "Language" menu). `AIP_WEB_TOKEN` sets a permanent link token (16–128 characters from `A-Za-z0-9-_`). In the browser you can handle runs, groups, answers to questions, retry/cancel/apply and logs |
| `aip repo list\|add <path>\|remove <path> [--json]` | Lists the repositories the daemon knows (`REPOSITORY`, `UNFINISHED`, `WAITING`, `QUEUED`). `add` finds the git root from a subdirectory. `remove` refuses while the repository has unfinished runs or queued tasks |
| `aip group answer <run-id> <group> <text>` | Answers a specialist's question (a group in `needs_human`) |
| `aip group retry <run-id> <group>` | Retries a failed or cancelled step from where it stopped, or retries the merge after a conflict |
| `aip run cancel <run-id>` / `aip group cancel <run-id> <group>` | Stops a group or a whole run |
| `aip run apply <run-id> [group...] [--force]` | Delivers ready groups to the working tree (or as a commit, or as a branch) |
| `aip run clean [run-id] [--all] [--json]` | Without an id, lists finished runs that can be cleaned up (id, title, finish time) and suggests `aip run clean <run-id>`; with `--json`, the same list as JSON. With an id, removes the worktrees and internal refs of a finished run (this happens automatically after delivery) |
| `aip version [--json]` | The aip version (same as `aip --version`); with `--json`, `{"version":"…"}` on one line |

In a terminal the output is colored. A status icon comes before each state (`✓` done, `✗` error, `?` waiting for an answer, `▸` running, `◦` pending, `⊘` cancelled), table headers are dimmed, `+N` is green and `−M` is red. Use the `--no-color` flag or the `NO_COLOR` variable to turn colors off, and `FORCE_COLOR=1` to turn them on. In a pipe or a file the output has no colors and no icons. MCP tool texts and `--json` output are never colored.

## Task queue

You can line up tasks in advance and run them one after another. Each repository has one queue, and every task goes through it: tasks from `aip queue add`, `aip run start`, specialists and the panel. `aip queue add` does not start the queue, while `aip run start` starts a stopped one (and lifts the pause). Every waiting task shows when it was added (`added 2026-11-01 14:32`).

```
aip queue add feature --task "Add a login form"       # to the end of the queue
aip queue add feature --groups groups.yaml --title "Forms"
aip queue list                                       # order, state, reason for stopping
aip queue move <item> 1                              # make the task first
aip queue edit <item> --task "New text"              # or: remove <item>
aip queue add feature --task "..." --no-auto-deliver  # no auto-delivery; --default-auto-deliver on edit clears the choice
aip queue start --parallel 2                         # take tasks from the front, 2 runs at a time
aip queue parallel 3                                 # change the number of simultaneous runs, in any queue state
aip queue pause                                      # take no new tasks, running runs keep working
aip queue run <item>                                 # start a task right now, beyond the limit; the run takes a place
```

- `aip queue start` takes tasks from the front of the queue. At most `parallel` runs go at the same time (1–20, 1 by default), and a freed place goes to the next task. `aip queue parallel <n>` changes the limit on the fly. When it grows, waiting tasks start at once (if the queue is started). When it shrinks, running runs are not interrupted, and new tasks wait until the number of runs drops below the limit. `aip queue list` shows how busy the queue is ("1 of 2 places taken") and, for every run, its workflow, progress by group, active steps, delivery mode and problem. When the tasks run out and all runs of the queue are finished, the queue stops by itself.
- `aip queue run <item>` and "Run now" in the panel create a queue run immediately, even when all places are taken. The run takes a place beyond the limit (for example, "3 of 2 places taken"), and the next task starts only when the number of runs drops below `parallel`. A problem in such a run stops the queue, like a problem in any queue run.
- A task becomes a run at the moment it starts: the working tree is snapshotted then, not when the task is added. So with `delivery.auto: true` a run keeps its place until its result is delivered, and the next task sees the result of the previous one. With `delivery.auto: false` the place is freed when the run finishes, and the next task does not see the previous result. For chains of tasks, turn auto-delivery on.
- The queue stops when one of its runs gets a problem: a group in `failed` or `conflict`, a cancelled run, or a delivery error (`apply_failed`). The reason is visible in `aip queue list`. A question for a human (`needs_human`) does not stop the queue. It stays started, the run with the question keeps its place (with `parallel: 1` the next task waits), and once the question is answered the queue goes on by itself. A run with a problem keeps its place. `aip queue start` marks the current problems as known and continues the queue; a new problem stops it again.
- If a run cannot be created (for example, the workflow file was removed from `aip/workflows/`), the task stays first with the error text, and the queue stops.
- A task that has become a run can no longer be edited or removed from the queue; manage the run with `aip run list` and `aip run cancel`.
- In `aip web` the queue is the "Queue" section (`#queue`) of the selected repository (at first, the one most recently added to the daemon's list). It has a form for a new task (workflow, task or groups, title), "Start" and "Pause" buttons, a parallelism field (1–20, saved without starting), and the reason for stopping with a link to the run and the group. Drag an item by its handle to reorder it; from the keyboard use `Alt+↑` / `Alt+↓` on the focused item. "Edit", "Delete" (with confirmation) and "Run now" are available on every waiting task. Runs created by the queue are marked "from the queue" in the runs list.
- The queue is stored in the daemon's database and survives a daemon restart; a started queue keeps taking tasks. The same actions are available through the `swarm_queue*` tools (see `docs/hosts.md`).

### Tags

Tags are named colored labels for tasks and runs. There is one catalog for all repositories. A name has at most 30 characters and is unique regardless of letter case (Cyrillic included). The color is one of ten: `gray`, `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `violet`, `pink`, `brown`. Without `--color`, the next color in turn is used.

```
aip tag add auth --color blue            # create a tag
aip tag list                             # the catalog (--json)
aip tag edit auth --name login           # rename and/or change the color; tasks and runs keep the tag
aip tag remove login                     # delete the tag and remove it from all tasks and runs
aip queue add feature --task "Login form" --tag auth --tag v2   # --tag can repeat; run start accepts it too
aip queue edit <item> --tag v2           # replaces all tags of the task; --no-tags removes them; with no flags the tags stay
aip run tag <run-id> auth v2             # add tags to a run in any state, including a finished one
aip run untag <run-id> v2                # remove tags
aip run list --tag auth --tag v2         # runs with at least one of the tags
```

- The tags of a task move to the run when the run is created from the task. An unknown tag name rejects the whole request; create a tag with `aip tag add`.
- A task that a specialist puts in the queue with `swarm_queue_add` gets all the tags its run has at that moment (both on the task and later on the run). A specialist cannot set tags itself, and no new tags are created. Tags added to a run later do not move to tasks that were already queued.
- Tags appear as `#name` in `aip run list`, `aip run show` and `aip queue list`. In JSON they are a `tags` field with a list of `{id, name, color}`. The `swarm_run`, `swarm_queue_add` and `swarm_queue_edit` tools accept an optional `tags`; the catalog cannot be managed through MCP.

The `aip daemon` starts automatically on the first request. How to connect Claude Code and OpenCode is described in `docs/hosts.md`.

The daemon and its clients (the CLI, `aip mcp`, `aip web`) compare builds. A build is identified by the version from `package.json` plus a fingerprint of the code files (`dist/` or `src/`) taken when the process starts, so a rebuild without a version bump also counts as a different build. If the daemon is older than the client and has no agents working and no merges in progress, the client stops it and starts a daemon of its own build; runs, queues and answers are kept in the database. If agents are working, the daemon keeps going and the client writes a warning to stderr. The next `aip` command after the agents finish restarts the daemon, or you can stop it at once with `kill <pid>` (running agents are stopped). `aip web` checks the daemon every 30 seconds and shows the same warning as a banner above the page. If the daemon is newer than the client, the daemon is left alone and the client asks you to restart itself. A daemon from a build without this check is never stopped automatically; the client only reports its pid.

## Where files live

- `~/.config/aip/` holds the shared configuration (`settings.yaml`, `specialists/`, `workflows/`); `aip/` in a repository takes precedence.
- `<repository>/.aip/` holds the group worktrees and step logs. The directory is added to `.git/info/exclude`; set another location with `workspace_dir`.
- `~/.local/state/aip/` (or `$XDG_STATE_HOME/aip/`) holds the state database, the socket and the daemon log.
- Several repositories on one daemon: see [Multiple repositories in `docs/hosts.md`](docs/hosts.md#multiple-repositories).

## Development

```sh
npm run check     # prettier --check → tsc → vitest
npm run build
```

The same steps and the panel controls are available through [just](https://github.com/casey/just) (1.27 or newer, needs `bash`; Windows is not supported). The recipes call the npm scripts, so the gate stays the same: `npm run check`.

```sh
just                # list the recipes
just check          # npm run check
just build          # npm run build
just web            # rebuild the frontend (dist/web) and restart aip web in the background
just web-restart    # restart aip web without rebuilding
just web-stop       # stop aip web
just web-status     # link and pid
just web-log        # aip web log
just web-dev        # Vite dev server proxying to the running aip web
```

`just web` keeps `aip web` running in the background on port 7341 (`AIP_WEB_PORT` or a recipe argument). The pid, the log and the token live in `.aip/web/`, so the link does not change between restarts and an open tab keeps working. A restart stops only its own process and an `aip web` you started by hand on that port; a foreign process on the port is left alone. `just web-stop` stops its own process and the `aip web` on the port from `.aip/web/port`. If the recipes did not start the panel, it does not touch processes on the port; to stop someone else's `aip web`, use `scripts/aip-web.sh stop <port>`. The recipes do not restart the `aip` daemon: if it is already running, `aip web` connects to it (and replaces it only if it is older and idle).
