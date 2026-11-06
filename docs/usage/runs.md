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
- A workflow with a `name` is printed as `<name> (<id>)`; without a `name`, as the id.
- `aip run show` prints a `System:` line with the system stages in the order split, commit message, resolver and delivery, for example `System: split done · message running · delivery pending`. A failed delivery shows its first reason there, even when no resolver ran.
- A waiting group has a `NOTE` saying what it waits for, for example `waiting for coder`. The `Groups:` line counts them as `waiting N`.

For a live stream of changes, `aip events --json` prints a snapshot and then one JSON line per change.

## Answering a specialist

A group in `needs_human` waits for you. Its question is in `aip run list` and `aip group show`.

```sh
aip group answer <run-id> <group> "Use the existing session table"
```

The answer resumes the step, in the same session when the runtime can continue it. A specialist can ask [several questions at once](../configuration/workflows.md#questions). A running queue can [answer by itself](queue.md#answering-questions).

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
- The workflow (steps, `on_reject`, `additional_prompt`, the split), the delivery settings and skipped steps stay as in the snapshot. Passed steps are not repeated.
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

## Run states

`state` in JSON and the `STATE` column in `aip run list`:

| State | Meaning |
|---|---|
| `needs_human` | At least one group (including the split, the commit message and the resolver) waits for a human's answer |
| `active` | Work is in progress |
| `finished` | Everything is complete |
| `failed` | The split step or a work group failed, or the delivery of a merged group ended in `apply_failed`. The state is recalculated after a retry or a successful delivery |
| `cancelled` | The run was cancelled. This takes precedence over `failed` |
| `queued` | A finished run waits in its queue as a [returned task](queue.md#returning-a-run) |
| `paused` | The run is [paused](queue.md#pausing-a-run) |
| `frozen` | The queue [froze](queue.md#freezing) the run |

A returned run keeps the statuses of its groups, and `finished` stays `true`, until the queue takes the task; then the state follows the groups again. A run that still has working groups keeps `active` or `needs_human`.

Other fields of a run in JSON:

- `finished`: use it to tell whether a run is unfinished; a run waiting for an answer is not `active`, and it is not finished either.
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
- `limit`: the runtime waits for its [usage limit](queue.md#usage-limit) to reset.
