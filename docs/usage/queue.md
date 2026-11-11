# Task queue

Every task goes through a queue: tasks from `aip queue add`, `aip run start`, specialists and the web panel. Each repository has one queue. It lines up tasks and runs them one after another or in parallel, and it is stored in the daemon's database, so it survives a daemon restart.

These actions are also in the [`swarm_queue*` tools](../hosts/mcp-tools.md) and in the [web panel](../web/queue.md). Labels for tasks are in [usage/tags.md](tags.md).

## Adding and ordering tasks

```
aip queue add feature --task "Add a login form"       # to the end of the queue
aip queue add feature --groups groups.yaml --title "Forms"
aip queue list                                       # order, state, reason for stopping
aip queue move <item> 1                              # make the task first
aip queue edit <item> --task "New text"              # or: remove <item>
aip queue add feature --task "Later" --postpone      # postponed: a running queue does not take it
```

- `aip queue add` does not start the queue. `aip run start` starts a stopped queue and lifts the pause.
- A waiting task shows when it was added (`added 2026-11-01 14:32`).
- Delivery for one task is set with [`--delivery-mode` and `--auto-deliver`](../configuration/delivery.md#settings-for-one-task).
- A task that has become a run can no longer be edited or removed from the queue. Manage the run with `aip run list` and `aip run cancel`.

### Task numbers

Every task gets an integer number within its repository when it is added: 1, 2, 3, and so on. The number never changes and is never given to another task, and it survives a daemon restart. A task that was refused does not take a number.

- The run created from a task keeps its number. A run returned to the queue keeps the number it already has.
- `aip queue list` prints the number as `#N` after the position (`1. #7 q…`), and in the lines of running runs and predecessors (`after #5 q…`).
- `aip run list` has a `#` column; `aip run show` and `aip run start` print `Run #N <run-id>`.
- The web panel shows `#N` next to the task and the run, and its run search finds `#N` exactly (`#7` does not find 17 or 70).
- A task is addressed by its id in commands; the number is for reading. `--parent` takes both.

### Postponed tasks

- `--postpone` on `aip queue add` and `aip queue edit` postpones a task. It keeps its place, but a running queue does not take it, and `aip queue list` shows `· postponed`.
- `--no-postpone` on `aip queue edit` clears the flag. The queue then takes the task at once if a place is free.
- Tasks that wait for a postponed task stay `waiting`.
- `swarm_queue_run_now` and "Run now" start a postponed task anyway. Starting the queue does not clear the flag.
- A queue without autopilot that has only postponed tasks left (and no runs) stops.
- `aip run start` and specialists cannot postpone a task.

## Running the queue

```
aip queue start --parallel 2    # take tasks from the front, 2 runs at a time
aip queue parallel 3            # change the number of simultaneous runs, in any queue state
aip queue pause                 # take no new tasks, running runs keep working
aip queue run <item>            # start a task right now
```

- At most `parallel` runs go at the same time (1–20, 1 by default). A freed place goes to the next task.
- When `parallel` grows, waiting tasks start at once if the queue is started. When it shrinks, running runs are not interrupted, and new tasks wait until the number of runs drops below the limit.
- `aip queue list` shows how busy the queue is ("1 of 2 places taken"). For every run it shows the pipeline, the progress by group and by step (`1/3 groups · steps 5/12`, or `splitting` while the task is being split), active steps, delivery mode and problem.
- When the tasks run out and all runs of the queue are finished, the queue stops by itself. A started queue keeps taking tasks after a daemon restart.

### When a task sees the previous result

A task becomes a run at the moment it starts. The working tree is snapshotted then, not when the task is added.

- With `delivery.auto: true` a run keeps its place until its result is delivered, so the next task sees the result of the previous one.
- With `delivery.auto: false` the place is freed when the run finishes, and the next task does not see the previous result.

For chains of tasks, turn auto-delivery on.

### Running a task right now

`aip queue run <item>` and "Run now" in the panel create a queue run immediately, even when all places are taken. When no place is free, the run that took a place last is [frozen](#freezing).

Only when nothing can be frozen does the run take a place beyond the limit (for example, "3 of 2 places taken"), and the next task starts when the number of runs drops below `parallel`. A problem in such a run stops the queue.

## Queue settings

`aip queue settings` changes only the settings you pass.

| Flag | Meaning |
|---|---|
| `--parallel <n>` | The number of simultaneous runs |
| `--autopilot on\|off` | A running queue does not stop when it becomes empty |
| `--auto-answer on\|off` | A running queue answers the questions of specialists with the answer text |
| `--skip-failed on\|off` | A run with a problem leaves its place and the queue goes on |
| `--autopilot-answer <text>` | The text the queue answers questions with when auto answer is on |
| `--default-autopilot-answer` | Restores the default text |
| `--on-limit wait\|stop` | What happens on a usage limit (see [Usage limit](#usage-limit)) |

```
aip queue settings --autopilot on
aip queue settings --auto-answer on
aip queue settings --skip-failed on --parallel 2
aip queue settings --autopilot-answer "Agree, pick the simplest option"
aip queue settings --on-limit stop
```

A call without settings is refused with `pass parallel, autopilot, autoAnswer, autopilotAnswer, skipFailed or onLimit`. The first line of `aip queue list` shows the modes (`autopilot on, auto answer off, skip failed off`, and `, on limit stop` when set).

### Autopilot

- A running queue with autopilot does not stop when it becomes empty. It takes tasks added later at once.
- A paused queue stays paused, and a task added to it does not start.
- Turning autopilot on starts a stopped queue that has no stop reason. A queue stopped on a problem stays stopped until `aip queue start`.
- Turning it off stops an empty running queue on the next step.
- Autopilot does not answer questions; that is the separate `auto answer` setting.

### Answering questions

A running queue with `auto answer` on answers the questions of specialists (a step that ended with `needs_human`). It does not depend on autopilot. The answer is the queue's answer text, by default "I agree with your recommendations…". The step restarts, and the decision is marked `autopilot`.

- Turning `auto answer` on never starts a stopped queue; a paused or stopped queue does not answer.
- It gives at most 3 answers in a row to one group, then the question waits for you.
- Stops for the `max_rounds` limit or for changes outside the worktree are never answered, nor are [`human_review` and `human_only`](../configuration/pipelines.md#asking-a-person) questions.

### Skip failed

- A run with a `failed`, `conflict` or `apply_failed` problem leaves its place at once. The queue does not stop and takes the next task. The run itself keeps working.
- Such runs are listed under `Skipped with a problem:` (at most 10, the earliest is dropped first). A run leaves the list when the problem is gone.
- A skipped run whose problem is fixed (a retry, an answer, a resolved conflict) takes a free place again. When every place is taken it waits [frozen](#freezing), first in the queue, and continues before new tasks as soon as a place frees. A run that only waits for auto-delivery keeps its place.
- A task that waits for a skipped run is blocked.
- A task that cannot start (for example, its pipeline was removed) stays in the queue with the error. It is not taken again until it is edited or the queue is started, and the queue goes on with the other tasks. After an edit it goes to position 1.
- `aip queue dismiss <run-id>` removes a skipped run from the list; `--repo` defaults to the repository of the run. The run keeps its status, stays in the run list and can still be delivered. A run that is not in the list is refused. A task that waits for the removed run stays blocked.

## When the queue stops

- The queue stops when one of its runs gets a problem: a group in `failed` or `conflict`, a delivery error (`apply_failed`), or a [usage limit](#usage-limit). The reason is visible in `aip queue list`, and the run keeps its place.
- `aip queue start` marks the current problems as known and continues the queue. A new problem stops it again.
- A question for a human (`needs_human`) does not stop the queue. The run with the question keeps its place (with `parallel: 1` the next task waits). Once the question is answered, the queue goes on by itself.
- If a run cannot be created (for example, the pipeline file was removed), the task stays first with the error text, and the queue stops.
- An incident of a task that an [observer](#observers) can take does not stop the queue.
- A manual cancel of a run never stops the queue. The cancelled run frees its place, the next task takes it, and the run does not go into the skipped list. Tasks that depend on the cancelled run are blocked.

### Observers

An incident of a task that an [observer](runs.md#observers) can take does not stop the queue.

- The task gets the state `repair` and the queue goes on. A task with unfinished work (a question) keeps its place. A failed task does not hold a place during the repair and gets it back only when its group is retried.
- A retry by an observer is not a priority action: it takes a free place, and with every place taken the task waits frozen, first in the queue, and no agent starts for it.
- Only a direct action of a person (retry, return, "Run now") may go beyond `parallel`.
- A new incident that no observer can take (observers are off, the project is not connected, the task is forbidden, or its repairs are used up) stops the queue by the rules above. An incident the queue already passed to observers does not stop it later, and the task waits for a person. A task with a `hold` is not watched and does not stop the queue.
- Auto-answers of the queue come first: a question reaches an observer only when the queue did not settle it.
- A repair is not counted in `max` or in the place limit of the queue. A failed task stays in the skipped list during a repair.
- A usage limit of the observer agent does not stop the queue.

### Usage limit

When an agent (`claude`) runs out of its subscription limit, the step stops with the reason `usage limit` and the time the limit resets. The limit of `opencode` is not recognized.

- Until the reset the daemon starts no step of that agent in any run, so no task is burnt.
- The queue stops (`Stopped: usage limit of claude in <run>, resets 20:50`), with or without skip failed.
- With `--on-limit wait` (the default) the group waits, and `aip run show` notes `waiting for claude usage limit, until 20:50`. It continues the same step and session after the reset, and the queue starts by itself (`, resumes automatically`). `aip queue pause` cancels the automatic start.
- With `--on-limit stop` the group fails (retry it with `aip group retry`) and the queue waits for `aip queue start`.
- A reset that passed while the daemon was down is picked up when it starts.

A [down network](../configuration/network.md) does not stop the queue: its runs start and their groups wait, shown as `(waiting for network)` in `aip queue list`.

## Skipping steps

```
aip queue add feature --task "Fix a typo" --skip review --skip qa  # this task skips the steps review and qa
aip queue edit <item> --skip qa                      # replaces the list of skipped steps; --no-skips runs every step again
```

`--skip <step>` is repeatable and also works on `aip run start`. It makes one task skip steps of its pipeline without editing the configuration. `aip queue list` shows `skip: review, qa`.

- It is refused when a step id is unknown (the answer lists the steps) or when no step is left.
- It is refused when a remaining step has `on_reject.goto` to a skipped step. Skip the returning step too: in `feature`, `review` and `qa` both return to `code`, so `--skip review --skip qa` is fine.
- For a pipeline with `split.pipeline` the steps of that pipeline are meant.
- The run gets the pipeline without those steps, so retries skip them too.
- A step removed from the configuration before the task starts gives the task an error.

To skip a step of a run that has started, see [Skipping a step](runs.md#skipping-a-step).

## Dependencies

```
aip queue add feature --task "Add the API" --after q1  # starts after item q1 (or a run id) is finished and delivered
aip queue edit <item> --no-after                       # clears the list
```

`--after <id>` is repeatable and works on `aip queue add`, `aip queue edit` and `aip run start`. The task waits for other tasks of the queue or for runs of the repository.

- A task starts when every predecessor is merged and delivered to the working tree.
- A ready task starts before a waiting one, so dependencies do not change the order of the list.
- `aip queue list` shows `after q1 (waiting)` or `after q1 (blocked)`. A predecessor is blocked when its run failed, was cancelled or is gone.
- A reference to the task itself, a cycle and an unknown id are refused.
- `aip run start` with an unmet dependency leaves the task in the queue and answers with `run: null`.

## Returning, pausing and freezing runs

### Returning a run

`aip queue return <run-id>` puts a run with failed or cancelled groups back in the queue as its first task. `--repo` defaults to the repository of the run. A skipped run leaves the skipped list.

- The run does not change until the queue takes the task on a free place (or `aip queue run <item>`). Then its failed and cancelled groups are retried from where they stopped, the work already done is kept, and the run holds a place again.
- While the task waits, the run shows as `queued` (the field `queueItem` holds the task id; the statuses of the groups do not change). Once the task is taken or removed, the run shows its own state again.
- `aip queue list` marks the task `returns <run-id>`. It can be moved, removed or given `--after`, but not edited otherwise.
- The one exception is `--skip`/`--no-skips` (MCP `skip`): it skips or restores the steps of the run itself at once, and the list replaces all skipped steps of the run. A step that every group has passed cannot be changed.
- A run that is already in the queue, holds a place or has nothing to retry is refused. A skipped run whose groups are merged but whose delivery failed has nothing to retry.

### Pausing a run

`aip run pause <run-id>` pauses any unfinished run of the repository (`--repo` defaults to the repository of the run), whether the queue is running or stopped. The agents of the run stop at once (a step that has already reported finishes and is committed), no new step starts, and the run frees its place.

- The run becomes the last task of the queue and shows as `paused` in `aip run list`, `aip run show` and `aip queue list` (`paused <run-id>`).
- A paused run does not stop the queue: its problems are not watched. Tasks that wait for it keep waiting.
- The queue never takes a paused run by itself, even on autopilot. `aip queue run <item>` ("Continue" in the web panel) continues it at once, whatever the limit. The stopped step continues in the same session; a failed or cancelled group is retried. `aip group retry` on a paused run also lifts the pause.
- A paused run stays in the queue: removing its task is refused while the run is unfinished. Cancel the run instead; it stays `paused` until you continue or remove the task.
- The pause is lifted by itself once the run is finished and has nothing to retry.
- A finished run, one that is already paused, and one that is already in the queue as a returned task are refused.

### Freezing

When a run needs a place and every place is taken, the queue freezes the run that took a place last instead of going over `parallel`. Freezing is never done by hand: pause a run to stop it yourself.

A place is needed by such a priority action:

- the queue taking the task of a returned run without a hold (`aip queue return`) in a running queue, at once, before ordinary tasks;
- `aip queue run <item>` / "Run now" / "Continue";
- a direct retry of a group, "Retry failed", after which the run holds a place.

What is frozen:

- The frozen run is the last one that took a place.
- A run is not frozen when a group waits for a human answer, when it is finished and waits for delivery, when it is on pause or already frozen, when it took its place by a priority action and holds it, or when it is the run that needs the place.
- When nobody can be frozen, the priority run takes a place over `parallel`.

What happens to a frozen run:

- It finishes its current steps and starts no new one (its agents are not stopped). It leaves its place, and its task goes first in the queue, marked `frozen <run-id>` in `aip queue list` (state `frozen` in `aip run list` and the panel). The state of the queue does not change.
- Its groups that do not run a step have the status `frozen`, and the time of the run stops once its last step ends.
- It continues by itself, in any state of the queue, as soon as a place is free and before any other task, regardless of `--after` and the postponed flag. Its failed groups are retried from where they stopped. "Continue" brings it back earlier; the run then holds a place over `parallel` if the priority run still holds one.
- It can be paused (it then waits at the end of the queue), and its task cannot be removed while the run is unfinished.

The queue does not take a task of a run on pause: a paused run is not a priority task and freezes nobody until you continue it.

`aip queue list --json` shows `freezeCandidate` (the run a priority action would freeze now, or `null`) and `priority` on every run card.
