# Running tasks

A run is a task being worked on: its groups, steps and result. This page follows a run from start to cleanup. For the terms see [getting-started/concepts.md](../getting-started/concepts.md), for every command see [usage/cli.md](cli.md). The same actions are in the [web panel](../web/runs.md) and in the [MCP tools](../hosts/mcp-tools.md).

## Starting a task

```sh
aip run start feature --task "Add a login form"
aip run watch
```

- `aip run start` puts the task at the end of the repository's [queue](queue.md) and starts the queue if it is stopped. Tasks from `swarm_run` and `/aip:run` go through the queue too.
- A run is created when the queue takes the task. If all places are taken, the command prints the position in the queue and "N of M places taken", and the task starts when a place frees up.
- To pass several independent tasks, use a file with a list of `{ title, task }` entries: `aip run start feature --groups groups.yaml`.
- A run gets a short title and an English name on its own (see [`naming`](../configuration/README.md#naming)). `--title` sets the title yourself.

Options of one task:

| Option | Read more |
|---|---|
| `--auto-deliver`, `--no-auto-deliver`, `--delivery-mode` | [Settings for one task](../configuration/delivery.md#settings-for-one-task) |
| `--skip <step>` | [Skipping steps](queue.md#skipping-steps) |
| `--after <id>` | [Dependencies](queue.md#dependencies) |
| `--tag <name>`, `--parent <run>` | [usage/tags.md](tags.md) |

A run starts from a snapshot of your working tree, so specialists also see your uncommitted edits (see [`workspace`](../configuration/README.md#workspace)). While the swarm works, your branch, index and working tree stay untouched.

## Following a run

```sh
aip run list                    # active and recent runs
aip run watch [run-id]          # refresh until it finishes
aip run show <run-id>           # the groups of one run
aip group show <run-id> <group> # attempts, verdicts, remarks, tokens, changed files, the tail of the log
```

- `aip run list` shows each run with its task number (`#` column), the first line of its task and a summary of changes (`2 files +367 −0`). With a run id, it prints the table of that run's groups.
- A pipeline with a `name` is printed as `<name> (<id>)`; without a `name`, as the id.
- `aip run show` prints a `System:` line with the system stages in the order split, commit message, resolver, observer and delivery, for example `System: split done · message running · delivery pending`. A failed delivery shows its first reason there, even when no resolver ran.
- A waiting group has a `NOTE` saying what it waits for, for example `waiting for coder` or `waiting for network: interface wt0 is down`. The `Groups:` line counts them as `waiting N`.

For a live stream of changes, `aip events --json` prints a snapshot and then one JSON line per change.

## Answering a specialist

A group in `needs_human` waits for you. Its question is in `aip run list` and `aip group show`.

```sh
aip group answer <run-id> <group> "Use the existing session table"
```

The answer resumes the step, in the same session when the runtime can continue it. A specialist can ask [several questions at once](../configuration/pipelines.md#questions). A running queue can [answer by itself](queue.md#answering-questions).

## Retrying

```sh
aip group retry <run-id> <group>
```

A retry continues a failed or cancelled step from where it stopped, or retries the merge after a conflict. It re-reads the [permissions](../configuration/permissions.md#refreshing-permissions), so a pattern you added to `allow_commands` applies. Failed or cancelled delivery steps are repeated through [`aip run apply`](../configuration/delivery.md#automatic-and-manual-delivery).

To put a run back in line, not retry it at once, see [Returning a run](queue.md#returning-a-run).

### Retry with the current configuration

An ordinary retry keeps the model, the runtime and the prompt of the snapshot, so a mistake there (a model name with a typo fails every attempt with `model_not_found`) survives every retry. Fix the specialist and retry with the current configuration: `aip group retry <run-id> <group> --refresh-config`, `swarm_retry` with `refresh_config: true`, or "Retry with current config" in the panel.

- Every specialist of the snapshot that is also in the current configuration takes its whole definition from it: `model`, `runtime`, `prompt`, `skills`, `timeout`, `max`, `permissions`, `allow_commands`, `tools`, `queue`. `claude.edit_mode` and `claude.settings` are taken too.
- A specialist removed from the configuration keeps its snapshot definition.
- The pipeline (steps, `on_reject`, `additional_prompt`, the split), the delivery settings and skipped steps stay as in the snapshot. Passed steps are not repeated.
- The new definitions apply to all following steps of all groups of the run.
- The retried group gets a warning with the changes, for example `config refreshed: reviewer model opsu → opus`. A changed prompt is listed as `reviewer prompt`, without its text. Nothing changed gives `config refreshed: no changes`.
- If the configuration does not load or pass validation, the retry is refused with `configuration not loaded: …`, and the run does not change.

## Skipping a step

```sh
aip run skip <run-id> review          # skip it for the whole run
aip run skip <run-id> review --off    # bring it back
```

This works on a step that is running or still ahead. A running step is stopped without a commit, and its partial changes stay uncommitted in the group worktree. A step every group has passed cannot be skipped.

## Stopping a run

- `aip run cancel <run-id>` stops a whole run, `aip group cancel <run-id> <group>` stops a group. `aip group retry` continues a cancelled group from the interrupted step.
- `aip run pause <run-id>` stops the agents and moves the run to the end of the queue: see [Pausing a run](queue.md#pausing-a-run).

## Getting the result

When the run is finished, its changes land in your working tree as uncommitted changes:

```sh
git diff        # review and commit it yourself
```

The changes are merged with your uncommitted edits. Modes, manual delivery, conflicts and the resolver are in [configuration/delivery.md](../configuration/delivery.md).

## Cleaning up

Worktrees and internal refs are removed by themselves after delivery. To do it by hand:

```sh
aip run clean                # list finished runs that can be cleaned up
aip run clean <run-id>       # remove the worktrees and internal refs of a finished run
```

## Artifacts

A specialist can publish files of its step as artifacts with `swarm_artifact`, before it reports. Use them for reports, logs and build output that should not enter the repository. They are shown on the ["Artifacts" tab](../web/runs.md#a-group) of the group: `.md` and `.log` files can be previewed, and every file can be downloaded.

- `content` is the text of the file (up to 1 MiB) and is the way to publish reports and logs.
- `path` is a file inside the worktree of the group (up to 16 MiB). A path outside the worktree, through a symlink out of it, or into `.git` is refused. A file that git tracks would also be committed, so use `path` for files git ignores.
- `file_name` is a plain name without a directory (up to 200 characters); `title` defaults to the name without the extension.
- Publishing a `file_name` again in the same attempt replaces the artifact; another attempt makes a new one. A group holds up to 200 artifacts.
- Artifacts never enter a step commit, the merge of the group or the delivered diff. The bytes lie in `artifacts/` of the state directory and live as long as the run record; `aip run clean` leaves them.

## Observers

Observers are agents that take a task after an incident and try to repair it without a person. They are off by default; the [settings](../web/settings.md#observers) of the panel switch them on, and `swarm.yaml` and the CLI cannot change them.

An incident is one of these states of a group:

- a question (`needs_human`) that the queue auto-answers did not settle at this queue step. A question for a person only (a `human_review` check or a `human_only` result) is never an incident;
- a `failed` group, including a group interrupted by a daemon restart;
- a `conflict` group;
- a delivery in `apply_failed`. All groups in `apply_failed` are repaired together.

A group cancelled by a person and a [usage limit](queue.md#usage-limit) are not incidents. The same state after a new attempt of the group is a new incident.

An observer works in one task and has tools only for it: answer a question of a group, retry a group, cancel a group or the whole task with a reason.
The daemon applies the rules a person has: a retry of a group a person cancelled, an answer to a question for a person only, a cancel of a group that waits for such a question, a cancel of the whole task while such a question is open, and any action on a service group other than split are refused. An answer is saved with the author `observer`, so a summary can read `answers: human 1, observer 2`.

- While an incident is repaired or waits for a free worker, the run has the state `repair`.
  Only an incident an observer has taken keeps the run unfinished: `finished` is `false`, `finishedAt` is empty, and `aip run show` prints the step `observer` in the `System:` line (in JSON it is `system` with kind `repair` and the service group `_repair`).
  A task that waits for a free worker keeps `finished` as it was and may have no `_repair` group yet.
  The group never changes the result of the run.
- A delivery incident is repaired in a separate copy where the changes of the task lie over your working tree with conflict markers. When the observer reports `done`, the daemon checks that no marker is left and delivers without force; your edits are never lost. A failed delivery leaves `apply_failed`.
- `done` ends the repair. `rejected` and `needs_human` end it as unsuccessful: the incident stays for a person, and the text of the report is shown in the task. An incident the observer reported on is not taken again.
- A crash or a timeout of the observer agent uses up one repair, and the incident can be taken again. A task has at most `maxRepairs` repairs; after that it waits for a person. An incident a person resolves while it waits for a worker is not repaired.
- A usage limit of the observer agent ends the attempt without waiting, does not use up a repair and does not stop the queue. The incident is taken again after the reset.
- A task with a `hold` (`paused`, `frozen`) is not taken. Pausing a task during a repair stops the agent without using up a repair.
- A task the observer cancelled shows the reason as `Observer cancelled: <reason>`. A cancelled group shows the reason as its `reason`, without the prefix.
- `aip run cancel <run-id>` also stops a repair that is in progress.

Switching observers off, or off for a project, does not interrupt repairs in progress; new incidents wait for a person. In the panel a person can forbid observers in one task, which stops its repair, and give the task back, which clears the ban and resets the repair count. The ban survives a daemon restart.
The request for the ban is in the [HTTP API](../web/http-api.md#runs); the settings are in [Observers](../web/http-api.md#observers).

## Run states

`state` in JSON and the `STATE` column in `aip run list`:

| State | Meaning |
|---|---|
| `needs_human` | At least one group (including the split, the commit message and the resolver) waits for a human's answer |
| `active` | Work is in progress |
| `finished` | Everything is complete |
| `failed` | The split step or a work group failed, or the delivery of a merged group ended in `apply_failed`. The state is recalculated after a retry or a successful delivery |
| `cancelled` | The run was cancelled. This takes precedence over `failed` |
| `repair` | An incident of the run is repaired by an [observer](#observers) or waits for a free worker |
| `queued` | A finished run waits in its queue as a [returned task](queue.md#returning-a-run) |
| `paused` | The run is [paused](queue.md#pausing-a-run) |
| `frozen` | The queue [froze](queue.md#freezing) the run |

A run with a `hold` (`paused`, `frozen`) never shows `repair`; its state follows the usual rules, so a `hold` with a question gives `needs_human`. Without a `hold`, `repair` takes precedence over `needs_human`.

An incident that is repaired keeps the run in `repair`, also when observers are switched off meanwhile or the last allowed repair is running. An incident that waits for a worker counts only if an observer can take it: observers are on, the project is connected, the task is not forbidden, it has no `hold` and `maxRepairs` is not used up.

A returned run keeps the statuses of its groups, and `finished` stays `true`, until the queue takes the task; then the state follows the groups again. A run that still has working groups keeps `active` or `needs_human`.

Other fields of a run in JSON:

- `finished`: use it to tell whether a run is unfinished; a run waiting for an answer is not `active`, and it is not finished either.
- `repair`: `allowed` (observers may take the task), `active` (the state is `repair`), `repairs` (how many repairs were made), `incident` (the incident being repaired, or `null`) and `cancelReason` (why an observer cancelled the task, or `null`).
- `waiting`: the number of waiting groups.
- `queueItem`: the id of the queue task that retries the run, or `null`.
- `deliveryStage`: `null` or an object with `status` (`pending`, `delivering`, `applied`, `apply_failed`). With `apply_failed` it also has the `reason` of the first failed group and their slugs in `groups`.

## Group statuses

| Status | Meaning |
|---|---|
| `queued` | Ready to start |
| `waiting` | Held back by the scheduler; see below |
| `running` | A step is in progress |
| `needs_human` | Waits for your answer |
| `merging` | Being merged inside the run |
| `merged` | Done and ready for delivery |
| `conflict` | The merge conflicted; retry it with `aip group retry` |
| `failed` | The step failed; retry it with `aip group retry` |
| `cancelled` | Stopped by you |
| `frozen`, `paused` | The group does not run a step while its run is [frozen](queue.md#freezing) or [paused](queue.md#pausing-a-run) |

A delivery that was refused gives the group `apply_failed`.

The `wait` object of a `waiting` group has `reason` and the details of the reason; `wait` is `null` for other groups. The run itself stays `active`.

- `specialist`: the [`max` of its specialist](../configuration/specialists.md#limits) is reached;
- `capacity`: the [`max` of the repository](../configuration/README.md#max) is reached;
- `limit`: the runtime waits for its [usage limit](queue.md#usage-limit) to reset;
- `network`: the [network check](../configuration/network.md) says the network is down (`until` is `null`), or the last attempt failed because of the network and the group pauses (`until`).

### Network

While the network is `down`, no agent starts in any run and the groups wait with `waiting for network: <problem>`. Agents that already run are not stopped, and command actions are not held. When the network is back the groups start by themselves.

An attempt that ends without a report on a network error gets the reason `network: <problem>`. The group waits 30 seconds, then repeats the same step in the same session. The failure does not switch the runtime of a [chain](../configuration/runtimes.md#runtime-chains) and is not a rejection. After 5 such failures of a step in a row the group fails.
