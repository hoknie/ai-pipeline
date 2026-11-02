# Command reference

The commands you use every day, the task queue, tags and the daemon. For installation see [install.md](install.md), for the configuration files see [configuration.md](configuration.md), for Claude Code and OpenCode see [hosts.md](hosts.md).

## Starting a task and getting the result

```sh
aip run start feature --task "Add a login form"
aip run watch
```

`aip run start` puts the task at the end of the repository's queue and starts the queue if it is stopped. A run is created when the queue takes the task. If all places are taken, the command prints the position in the queue and "N of M places taken", and the task starts when a place frees up. Tasks from `swarm_run` and `/aip:run` follow the same path.

To pass several independent tasks, use a file with a list of `{ title, task }` entries: `aip run start feature --groups groups.yaml`. The flags `--auto-deliver` and `--no-auto-deliver` override auto-delivery for one run (by default `delivery.auto` applies). `--delivery-mode worktree|commit|branch` sets how the result of one run is delivered (by default `delivery.mode` applies). A run gets a short title and an English name on its own (see `naming` in `docs/configuration.md`); you can set the title yourself with `--title`.

Look at the result. A run starts from a snapshot of your working tree, so specialists also see your uncommitted edits. While the swarm works, your branch, index and working tree stay untouched, and no extra branches appear. When the run is finished, its changes land in your working tree as uncommitted changes on their own. With `delivery: { auto: false }`, run `aip run apply` yourself:

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
| `aip web start [--open]` / `stop` / `restart [--open]` / `status [--json]` | Control the panel the daemon serves in the background, like `aip daemon …`. `start` raises it (even with `web.autostart: false`), `stop` stops only the panel (the daemon and its agents keep running), `restart` re-reads the `web` settings and keeps the token, `status` prints `running (pid N)`, the link and the address, or `not running` with the `reason` and exit code 3 |
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
aip queue add feature --task "..." --delivery-mode branch  # deliver as an aip/<run-id> branch; --default-delivery-mode on edit clears the choice
aip queue add feature --task "Fix a typo" --skip review --skip qa  # this task skips the steps review and qa
aip queue edit <item> --skip qa                      # replaces the list of skipped steps; --no-skips runs every step again
aip queue add feature --task "Add the API" --after q1  # starts after item q1 (or a run id) is finished and delivered; --no-after on edit clears it
aip queue start --parallel 2                         # take tasks from the front, 2 runs at a time
aip queue parallel 3                                 # change the number of simultaneous runs, in any queue state
aip queue settings --autopilot on                    # a running queue does not stop when it becomes empty
aip queue settings --skip-failed on --parallel 2     # a failed run leaves its place, the queue goes on; only the passed settings change
aip queue settings --autopilot-answer "Agree, pick the simplest option"  # the text the autopilot answers questions with; --default-autopilot-answer restores the default
aip queue pause                                      # take no new tasks, running runs keep working
aip queue run <item>                                 # start a task right now, beyond the limit; the run takes a place
```

- `--skip <step>` (repeatable; also on `aip run start`) makes one task skip steps of its workflow without editing `swarm.yaml`. It is refused when a step id is unknown (the answer lists the steps), when no step is left, or when a remaining step has `on_reject.goto` to a skipped step (skip the returning step too: in `feature`, `review` and `qa` both return to `code`, so `--skip review --skip qa` is fine). For a workflow with `split.workflow` the steps of that workflow are meant. `aip queue list` shows `skip: review, qa`. The run gets the workflow without those steps, so retries skip them too. A step removed from `swarm.yaml` before the task starts gives the task an error, like a missing workflow.
- `aip queue start` takes tasks from the front of the queue. At most `parallel` runs go at the same time (1–20, 1 by default), and a freed place goes to the next task. `aip queue parallel <n>` changes the limit on the fly. When it grows, waiting tasks start at once (if the queue is started). When it shrinks, running runs are not interrupted, and new tasks wait until the number of runs drops below the limit. `aip queue list` shows how busy the queue is ("1 of 2 places taken") and, for every run, its workflow, progress by group and by step (`1/3 groups · steps 5/12`, or `splitting` while the task is being split), active steps, delivery mode and problem. When the tasks run out and all runs of the queue are finished, the queue stops by itself.
- `aip queue settings` changes only the settings you pass: `--parallel <n>`, `--autopilot on|off`, `--skip-failed on|off`; `--autopilot-answer <text>` (or `--default-autopilot-answer`); a call without them is refused with `pass parallel, autopilot, autopilotAnswer or skipFailed`. `aip queue list` shows the modes in its first line (`autopilot on, skip failed off`).
- Autopilot: a running queue does not stop when it becomes empty and takes tasks added later at once. A paused queue stays paused, and a task added to it does not start. Turning autopilot on starts a stopped queue that has no stop reason; a queue stopped on a problem stays stopped until `aip queue start`. Turning it off stops an empty running queue on the next step. A running queue with autopilot also answers the questions of specialists (a step that ended with `needs_human`) with the queue's answer text — by default "I agree with your recommendations…" — and the step restarts; the decision is marked `autopilot`. It gives at most 3 answers in a row to one group, then the question waits for you; stops for the `max_rounds` limit or for changes outside the worktree are never answered by the autopilot.
- Skip failed: a run with a stopping problem (`failed`, `conflict`, `cancelled`, `apply_failed`) leaves its place at once, the queue does not stop and takes the next task; the run itself keeps working. Such runs are listed under `Skipped with a problem:` (at most 10, the earliest is dropped first; a run leaves the list when the problem is gone). A skipped run whose problem is fixed (a retry, an answer, a resolved conflict) goes back to the front of the queue's places, even over the `parallel` limit, and new tasks wait until a place frees; a task with an error goes to position 1 after it is edited. A task that waits for a skipped run is blocked. A task that cannot start (for example, its workflow was removed) stays in the queue with the error and is not taken again until it is edited or the queue is started; the queue goes on with the other tasks.
- `aip queue run <item>` and "Run now" in the panel create a queue run immediately, even when all places are taken. The run takes a place beyond the limit (for example, "3 of 2 places taken"), and the next task starts only when the number of runs drops below `parallel`. A problem in such a run stops the queue, like a problem in any queue run.
- A task becomes a run at the moment it starts: the working tree is snapshotted then, not when the task is added. So with `delivery.auto: true` a run keeps its place until its result is delivered, and the next task sees the result of the previous one. With `delivery.auto: false` the place is freed when the run finishes, and the next task does not see the previous result. For chains of tasks, turn auto-delivery on.
- The queue stops when one of its runs gets a problem: a group in `failed` or `conflict`, a cancelled run, or a delivery error (`apply_failed`). The reason is visible in `aip queue list`. A question for a human (`needs_human`) does not stop the queue. It stays started, the run with the question keeps its place (with `parallel: 1` the next task waits), and once the question is answered the queue goes on by itself. A run with a problem keeps its place. `aip queue start` marks the current problems as known and continues the queue; a new problem stops it again.
- If a run cannot be created (for example, the workflow file was removed from `aip/workflows/`), the task stays first with the error text, and the queue stops.
- `--after <id>` (repeatable; on `aip queue add`, `aip queue edit` and `aip run start`) makes a task wait for other tasks of the queue or for runs of the repository; `--no-after` on `aip queue edit` clears the list. A task starts when every predecessor is merged and delivered to the working tree, and a ready task overtakes a waiting one, so dependencies do not change the order of the list. `aip queue list` shows `after q1 (waiting)` or `after q1 (blocked)`; a predecessor is blocked when its run failed, was cancelled or is gone. A reference to the task itself, a cycle and an unknown id are refused. `aip run start` with an unmet dependency leaves the task in the queue and answers with `run: null`.
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
- A task that a specialist puts in the queue with `swarm_queue_add` gets all the tags its run has at that moment (both on the task and later on the run). A specialist cannot set tags itself, and no new tags are created. Tags added to a run later do not move to tasks that were already queued, except tasks that wait for that run with `after`.
- A task with `after` also gets the tags of its predecessors (queue items or runs), after its own tags. When `aip queue edit --after` adds a predecessor, its tags are added to the task even if `--tag` is passed. A tag that is added later to a predecessor (a queue item or a run) is appended to the waiting tasks that depend on it directly or through a chain. Removing a tag, removing a link and runs that already exist do not change other tags.
- Tags appear as `#name` in `aip run list`, `aip run show` and `aip queue list`. In JSON they are a `tags` field with a list of `{id, name, color}`. The `swarm_run`, `swarm_queue_add` and `swarm_queue_edit` tools accept an optional `tags`; the catalog cannot be managed through MCP.

The `aip daemon` starts automatically on the first request. You can also control the background daemon by hand: `aip daemon start` (does nothing if it runs), `aip daemon stop`, `aip daemon restart` and `aip daemon status [--json]`. `stop` and `restart` refuse with code 1 while agents work or a merge runs; `--force` stops the daemon together with its agents, and their steps become `failed` with the reason `interrupted` at the next start. `status` starts and stops nothing and exits with code 3 when no daemon runs. Bare `aip daemon` still runs the daemon in the foreground. How to connect Claude Code and OpenCode is described in `docs/hosts.md`.

The daemon and its clients (the CLI, `aip mcp`, `aip web`) compare builds. A build is identified by the version from `package.json` plus a fingerprint of the code files (`dist/` or `src/`) taken when the process starts, so a rebuild without a version bump also counts as a different build. If the daemon is older than the client and has no agents working and no merges in progress, the client stops it and starts a daemon of its own build; runs, queues and answers are kept in the database. If agents are working, the daemon keeps going and the client writes a warning to stderr. The next `aip` command after the agents finish restarts the daemon, or you can replace it at once with `aip daemon restart --force` (running agents are stopped). `aip web` checks the daemon every 30 seconds and shows the same warning as a banner above the page. If the daemon is newer than the client, the daemon is left alone and the client asks you to restart itself. A daemon from a build without this check is never stopped automatically; the client only reports its pid.

## Where files live

- `~/.config/aip/` holds the shared configuration (`settings.yaml`, `specialists/`, `workflows/`); `aip/` in a repository takes precedence.
- `<repository>/.aip/` holds the group worktrees and step logs. The directory is added to `.git/info/exclude`; set another location with `workspace_dir`.
- `~/.local/state/aip/` (or `$XDG_STATE_HOME/aip/`) holds the state database, the socket and the daemon log.
- Several repositories on one daemon: see [Multiple repositories in `docs/hosts.md`](docs/hosts.md#multiple-repositories).

