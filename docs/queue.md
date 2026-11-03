# Task queue and tags

The queue lines up tasks and runs them one after another or in parallel. Tags are colored labels for tasks and runs. For the other commands see [cli.md](cli.md).

## Add and order tasks

Each repository has one queue. Every task goes through it: tasks from `aip queue add`, `aip run start`, specialists and the web panel.

- `aip queue add` does not start the queue.
- `aip run start` starts a stopped queue and lifts the pause.
- A waiting task shows when it was added (`added 2026-11-01 14:32`).

```
aip queue add feature --task "Add a login form"       # to the end of the queue
aip queue add feature --groups groups.yaml --title "Forms"
aip queue list                                       # order, state, reason for stopping
aip queue move <item> 1                              # make the task first
aip queue edit <item> --task "New text"              # or: remove <item>
aip queue add feature --task "Later" --postpone      # postponed: a running queue does not take it
aip queue return <run-id>                            # put a failed or cancelled run back first in the queue
```

Delivery for one task is set with `--auto-deliver`, `--delivery-mode` and their `--default-*` flags (see [`delivery`](configuration.md#delivery)).

### Postponed tasks

- `--postpone` on `aip queue add` and `aip queue edit` postpones a task. It keeps its place, but a running queue does not take it, and `aip queue list` shows `· postponed`.
- `--no-postpone` on `aip queue edit` clears the flag. The queue then takes the task at once if a place is free.
- Tasks that wait for a postponed task stay `waiting`.
- `swarm_queue_run_now` and "Run now" start a postponed task anyway. Starting the queue does not clear the flag.
- A queue without autopilot that has only postponed tasks left (and no runs) stops.
- `aip run start` and specialists cannot postpone a task. In `aip web` the "In work" switch of a row postpones a task.

### Returning a run

- `aip queue return <run-id>` puts a run with failed or cancelled groups back in the queue as its first task. `--repo` defaults to the repository of the run. A skipped run leaves the skipped list.
- The run does not change until the queue takes the task on a free place (or `aip queue run <item>`). Then its failed and cancelled groups are retried from where they stopped, the work already done is kept, and the run holds a place again.
- `aip queue list` marks the task `returns <run-id>`. It can be moved, removed or given `--after`, but not edited otherwise.
- A run that is already in the queue, holds a place or has nothing to retry is refused.

A task that has become a run can no longer be edited or removed from the queue. Manage the run with `aip run list` and `aip run cancel`.

The queue is stored in the daemon's database and survives a daemon restart. A started queue keeps taking tasks.

These actions are also in the `swarm_queue*` tools (see [hosts.md](hosts.md)) and in the [web panel](web.md).

## Running the queue

```
aip queue start --parallel 2    # take tasks from the front, 2 runs at a time
aip queue parallel 3            # change the number of simultaneous runs, in any queue state
aip queue pause                 # take no new tasks, running runs keep working
aip queue run <item>            # start a task right now, beyond the limit; the run takes a place
```

- At most `parallel` runs go at the same time (1–20, 1 by default). A freed place goes to the next task.
- When `parallel` grows, waiting tasks start at once (if the queue is started).
- When `parallel` shrinks, running runs are not interrupted. New tasks wait until the number of runs drops below the limit.
- `aip queue list` shows how busy the queue is ("1 of 2 places taken").
- For every run it shows the workflow, the progress by group and by step (`1/3 groups · steps 5/12`, or `splitting` while the task is being split), active steps, delivery mode and problem.
- When the tasks run out and all runs of the queue are finished, the queue stops by itself.
- `aip queue run <item>` and "Run now" in the panel create a queue run immediately, even when all places are taken.
- Such a run takes a place beyond the limit (for example, "3 of 2 places taken"). The next task starts only when the number of runs drops below `parallel`.
- A problem in such a run stops the queue.

A task becomes a run at the moment it starts. The working tree is snapshotted then, not when the task is added.

- With `delivery.auto: true` a run keeps its place until its result is delivered, so the next task sees the result of the previous one.
- With `delivery.auto: false` the place is freed when the run finishes, and the next task does not see the previous result.
- For chains of tasks, turn auto-delivery on.

## Queue settings

`aip queue settings` changes only the settings you pass.

| Flag | Meaning |
|---|---|
| `--parallel <n>` | The number of simultaneous runs |
| `--autopilot on\|off` | A running queue does not stop when it becomes empty |
| `--skip-failed on\|off` | A run with a problem leaves its place and the queue goes on |
| `--autopilot-answer <text>` | The text the autopilot answers questions with |
| `--default-autopilot-answer` | Restores the default text |
| `--on-limit wait\|stop` | What happens on a usage limit (see [Usage limit](#usage-limit)) |

```
aip queue settings --autopilot on
aip queue settings --skip-failed on --parallel 2
aip queue settings --autopilot-answer "Agree, pick the simplest option"
aip queue settings --on-limit stop
```

A call without settings is refused with `pass parallel, autopilot, autopilotAnswer, skipFailed or onLimit`. The first line of `aip queue list` shows the modes (`autopilot on, skip failed off`, and `, on limit stop` when set).

## Autopilot

- A running queue with autopilot does not stop when it becomes empty. It takes tasks added later at once.
- A paused queue stays paused, and a task added to it does not start.
- Turning autopilot on starts a stopped queue that has no stop reason. A queue stopped on a problem stays stopped until `aip queue start`.
- Turning it off stops an empty running queue on the next step.
- A running queue with autopilot also answers the questions of specialists (a step that ended with `needs_human`). The answer is the queue's answer text, by default "I agree with your recommendations…". The step restarts, and the decision is marked `autopilot`.
- It gives at most 3 answers in a row to one group, then the question waits for you.
- Stops for the `max_rounds` limit or for changes outside the worktree are never answered by the autopilot.

## Skip failed

- A run with a `failed`, `conflict` or `apply_failed` problem leaves its place at once. The queue does not stop and takes the next task. The run itself keeps working.
- Such runs are listed under `Skipped with a problem:` (at most 10, the earliest is dropped first). A run leaves the list when the problem is gone.
- A skipped run whose problem is fixed (a retry, an answer, a resolved conflict) goes back to the front of the queue's places, even over the `parallel` limit. New tasks wait until a place frees.
- A task with an error goes to position 1 after it is edited.
- A task that waits for a skipped run is blocked.
- A task that cannot start (for example, its workflow was removed) stays in the queue with the error. It is not taken again until it is edited or the queue is started. The queue goes on with the other tasks.

Cancelling a run of the queue always stops the queue, with or without skip failed. The queue does not take the next task in its place. Continue with `aip queue start`.

## Usage limit

When an agent (`claude`) runs out of its subscription limit, the step stops with the reason `usage limit` and the time the limit resets.

- Until then the daemon starts no step of that agent in any run, so no task is burnt.
- The queue stops (`Stopped: usage limit of claude in <run>, resets 20:50`), with or without skip failed.
- With `--on-limit wait` (the default) the group waits in `queued` (`queued (usage limit, until 20:50)` in `aip run status`). It continues the same step and session after the reset, and the queue starts by itself (`, resumes automatically`). `aip queue pause` cancels the automatic start.
- With `--on-limit stop` the group fails (retry it with `aip run retry`) and the queue waits for `aip queue start`.
- A reset that passed while the daemon was down is picked up when it starts.
- The limit of `opencode` is not recognized.

## When the queue stops

- The queue stops when one of its runs gets a problem: a group in `failed` or `conflict`, a cancelled run, or a delivery error (`apply_failed`), or a usage limit. The reason is visible in `aip queue list`.
- A run with a problem keeps its place.
- `aip queue start` marks the current problems as known and continues the queue. A new problem stops it again.
- A question for a human (`needs_human`) does not stop the queue. The run with the question keeps its place (with `parallel: 1` the next task waits). Once the question is answered, the queue goes on by itself.
- If a run cannot be created (for example, the workflow file was removed from `aip/workflows/`), the task stays first with the error text, and the queue stops.

## Skipping steps

```
aip queue add feature --task "Fix a typo" --skip review --skip qa  # this task skips the steps review and qa
aip queue edit <item> --skip qa                      # replaces the list of skipped steps; --no-skips runs every step again
```

- `--skip <step>` is repeatable and also works on `aip run start`. It makes one task skip steps of its workflow without editing the configuration.
- It is refused when a step id is unknown (the answer lists the steps) or when no step is left.
- It is refused when a remaining step has `on_reject.goto` to a skipped step. Skip the returning step too: in `feature`, `review` and `qa` both return to `code`, so `--skip review --skip qa` is fine.
- For a workflow with `split.workflow` the steps of that workflow are meant.
- `aip queue list` shows `skip: review, qa`.
- The run gets the workflow without those steps, so retries skip them too.
- A step removed from the configuration before the task starts gives the task an error.

## Dependencies

```
aip queue add feature --task "Add the API" --after q1  # starts after item q1 (or a run id) is finished and delivered
aip queue edit <item> --no-after                       # clears the list
```

- `--after <id>` is repeatable and works on `aip queue add`, `aip queue edit` and `aip run start`. The task waits for other tasks of the queue or for runs of the repository.
- A task starts when every predecessor is merged and delivered to the working tree.
- A ready task starts before a waiting one, so dependencies do not change the order of the list.
- `aip queue list` shows `after q1 (waiting)` or `after q1 (blocked)`. A predecessor is blocked when its run failed, was cancelled or is gone.
- A reference to the task itself, a cycle and an unknown id are refused.
- `aip run start` with an unmet dependency leaves the task in the queue and answers with `run: null`.

## Tags

Tags are named colored labels for tasks and runs. There is one catalog for all repositories.

- A name has at most 30 characters and is unique regardless of letter case (Cyrillic included).
- The color is one of ten: `gray`, `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `violet`, `pink`, `brown`. Without `--color`, the next color in turn is used.

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

- The tags of a task move to the run when the run is created from the task.
- An unknown tag name rejects the whole request. Create the tag with `aip tag add`.
- Tags appear as `#name` in `aip run list`, `aip run show` and `aip queue list`. In JSON they are a `tags` field with a list of `{id, name, color}`.
- The `swarm_run`, `swarm_queue_add` and `swarm_queue_edit` tools accept an optional `tags`. The catalog cannot be managed through MCP.

Tags of tasks that a specialist queues:

- A task that a specialist puts in the queue with `swarm_queue_add` gets all the tags its run has at that moment.
- A specialist cannot set tags itself.
- When the run has no tags, the first `swarm_queue_add` creates a tag for the chain and puts it on the run and on the task. Later tasks of the chain get it by the rules above, so no second tag appears.
- The name of that tag is the name of the run (without a name: the transliterated title, without a title: the run id). It is cut to 30 characters at the last whole word; when the name is taken, `-2`, `-3`, … is added. An existing tag with the same name is not reused.
- When the workflow or `after` of the task is wrong, the call fails and no tag is created.
- Tags added to a run later do not move to tasks that were already queued, except tasks that wait for that run with `after`.

Tags of tasks with `after`:

- A task with `after` also gets the tags of its predecessors (queue items or runs), after its own tags.
- When `aip queue edit --after` adds a predecessor, its tags are added to the task even if `--tag` is passed.
- A tag added later to a predecessor is appended to the waiting tasks that depend on it directly or through a chain.
- Removing a tag, removing a link and runs that already exist do not change other tags.
