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
aip queue dismiss <run-id>                           # remove a skipped run from the skipped list
```

Delivery for one task is set with `--auto-deliver`, `--delivery-mode` and their `--default-*` flags (see [`delivery`](configuration.md#delivery)).

### Task numbers

Every task gets an integer number within its repository when it is added to the queue: 1, 2, 3, and so on. The number never changes and is never given to another task, so it stays the same when tasks are removed or moved. A task that was refused does not take a number.

- The run created from a task keeps its number. A run returned to the queue (see below) keeps the number it already has.
- The numbers do not close up after tasks are removed, and they survive a daemon restart.
- `aip queue list` prints the number as `#N` after the position (`1. #7 q…`), and in the lines of running runs and predecessors (`after #5 q…`). `aip run list` has a `#` column; `aip run show` and `aip run start` print `Run #N <run-id>`. The web panel shows `#N` next to the task and the run, and the run search finds `#N` exactly (`#7` does not find 17 or 70).
- A task is still addressed by its id in commands; the number is for reading.

### Postponed tasks

- `--postpone` on `aip queue add` and `aip queue edit` postpones a task. It keeps its place, but a running queue does not take it, and `aip queue list` shows `· postponed`.
- `--no-postpone` on `aip queue edit` clears the flag. The queue then takes the task at once if a place is free.
- Tasks that wait for a postponed task stay `waiting`.
- `swarm_queue_run_now` and "Run now" start a postponed task anyway. Starting the queue does not clear the flag.
- A queue without autopilot that has only postponed tasks left (and no runs) stops.
- `aip run start` and specialists cannot postpone a task. In `aip web` the "In work" switch of a row postpones a task.

### Returning a run

- `aip queue return <run-id>` puts a run with failed or cancelled groups back in the queue as its first task. `--repo` defaults to the repository of the run. A skipped run leaves the skipped list.
- Except for `--skip`/`--no-skips`, the run does not change until the queue takes the task on a free place (or `aip queue run <item>`). Then its failed and cancelled groups are retried from where they stopped, the work already done is kept, and the run holds a place again.
- While the task waits, `aip run list`, `aip run show`, `swarm_status` and the web panel show the run as `queued` (the field `queueItem` holds the task id; the statuses of the groups do not change). Once the task is taken or removed, the run shows its own state again.
- `aip queue list` marks the task `returns <run-id>`. It can be moved, removed or given `--after`, but not edited otherwise. The one exception is `--skip`/`--no-skips` (MCP `skip`): it skips or restores the steps of the run itself at once, and the list replaces all skipped steps of the run (the task shows the steps the run skips now). A step that every group has passed cannot be changed.
- A run that is already in the queue, holds a place or has nothing to retry is refused. A skipped run whose groups are merged but whose delivery failed has nothing to retry.
- `aip queue dismiss <run-id>` removes a skipped run from the skipped list; `--repo` defaults to the repository of the run. The run itself does not change: it keeps its status and stays in the run list, and it can still be delivered. A run that is not in the skipped list is refused. A task that waits for the removed run (`--after`) stays blocked.

### Pausing a run

- `aip run pause <run-id>` pauses any unfinished run of the repository (`--repo` defaults to the repository of the run), whether the queue is running or stopped. The agents of the run stop at once (a step that has already reported finishes and is committed), no new step starts, and the run frees its place.
- The run becomes the last task of the queue and shows as `paused` in `aip run list`, `aip run show` and `aip queue list` (`paused <run-id>`).
- The interrupted step continues in the same session when the run is continued.
- A paused run does not stop the queue: its problems are not watched. Tasks that wait for it keep waiting.
- The task is taken in its turn like any other, and `aip queue run <item>` ("Continue" in the web panel) continues it at once, whatever the limit. The run then goes on: the stopped step continues in the same session; a failed or cancelled group is retried. `aip group retry` on a paused run also lifts the pause.
- A paused run stays in the queue: removing its task is refused while the run is unfinished. Cancel the run instead; it stays `paused` until you continue or remove the task.
- The pause is lifted by itself once the run is finished and has nothing to retry. A run with nothing to pause (finished), one that is already paused, or one that is already in the queue as a returned task is refused.

### Freezing

When a run needs a place and every place is taken, the queue freezes the run that took a place last instead of going over `parallel`. Such a priority action is:

- the queue taking the task of a returned run without a hold (`aip queue return`) in a running queue, at once, before ordinary tasks;
- `aip queue run <item>` / "Run now" / "Continue";
- a direct retry of a group, "Retry failed", after which the run holds a place.

How it works:

- The frozen run is the last one that took a place. A run is not frozen when a group waits for a human answer, when it is finished and waits for delivery, when it is on pause or already frozen, when it is itself a priority run (it took its place by a priority action and holds it), or when it is the run that needs the place. When nobody can be frozen, the priority run takes a place over `parallel`.
- A frozen run finishes its current steps and starts no new one (its agents are not stopped). It leaves its place, and its task goes first in the queue, marked `frozen <run-id>` in `aip queue list` (state `frozen` in `aip run list` and the panel). The state of the queue does not change.
- The groups of a frozen run that do not run a step have the status `frozen` (`paused` for a paused run), and the time of the run stops once its last step ends.
- A frozen run continues by itself, in any state of the queue, as soon as a place is free and before any other task, regardless of `--after` and the postponed flag. Its failed groups are retried from where they stopped. "Continue" brings it back earlier; the run then holds a place over `parallel` if the priority run still holds one.
- Freezing is never done by hand: pause a run to stop it yourself. A frozen run can be paused (it then waits at the end of the queue), and its task cannot be removed while the run is unfinished.
- A task of a run on pause is taken only when its turn comes; a returned run on pause is not a priority task and freezes nobody.
- `aip queue list --json` shows `freezeCandidate` (the run a priority action would freeze now, or `null`) and `priority` on every run card.

A task that has become a run can no longer be edited or removed from the queue. Manage the run with `aip run list` and `aip run cancel`.

The queue is stored in the daemon's database and survives a daemon restart. A started queue keeps taking tasks.

These actions are also in the `swarm_queue*` tools (see [hosts.md](hosts.md)) and in the [web panel](web.md).

## Running the queue

```
aip queue start --parallel 2    # take tasks from the front, 2 runs at a time
aip queue parallel 3            # change the number of simultaneous runs, in any queue state
aip queue pause                 # take no new tasks, running runs keep working
aip queue run <item>            # start a task right now; the last run that took a place is frozen if none is free
```

- At most `parallel` runs go at the same time (1–20, 1 by default). A freed place goes to the next task.
- When `parallel` grows, waiting tasks start at once (if the queue is started).
- When `parallel` shrinks, running runs are not interrupted. New tasks wait until the number of runs drops below the limit.
- `aip queue list` shows how busy the queue is ("1 of 2 places taken").
- For every run it shows the workflow, the progress by group and by step (`1/3 groups · steps 5/12`, or `splitting` while the task is being split), active steps, delivery mode and problem.
- When the tasks run out and all runs of the queue are finished, the queue stops by itself.
- `aip queue run <item>` and "Run now" in the panel create a queue run immediately, even when all places are taken. When no place is free, the run that took a place last is frozen (see [Freezing](#freezing)).
- Only when nothing can be frozen does such a run take a place beyond the limit (for example, "3 of 2 places taken"). The next task starts only when the number of runs drops below `parallel`.
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

## Autopilot

- A running queue with autopilot does not stop when it becomes empty. It takes tasks added later at once.
- A paused queue stays paused, and a task added to it does not start.
- Turning autopilot on starts a stopped queue that has no stop reason. A queue stopped on a problem stays stopped until `aip queue start`.
- Turning it off stops an empty running queue on the next step.
- Autopilot does not answer questions; that is the separate `auto answer` setting.

## Answering questions

- A running queue with `auto answer` on answers the questions of specialists (a step that ended with `needs_human`). It does not depend on autopilot. The answer is the queue's answer text, by default "I agree with your recommendations…". The step restarts, and the decision is marked `autopilot`.
- Turning `auto answer` on never starts a stopped queue; a paused or stopped queue does not answer.
- It gives at most 3 answers in a row to one group, then the question waits for you.
- Stops for the `max_rounds` limit or for changes outside the worktree are never answered.
- Queues saved before the split get `auto answer` equal to their autopilot, so their behaviour does not change.

## Skip failed

- A run with a `failed`, `conflict` or `apply_failed` problem leaves its place at once. The queue does not stop and takes the next task. The run itself keeps working.
- Such runs are listed under `Skipped with a problem:` (at most 10, the earliest is dropped first). A run leaves the list when the problem is gone.
- A skipped run whose problem is fixed (a retry, an answer, a resolved conflict) goes back to the front of the queue's places, even over the `parallel` limit. New tasks wait until a place frees.
- A task with an error goes to position 1 after it is edited.
- A task that waits for a skipped run is blocked.
- A task that cannot start (for example, its workflow was removed) stays in the queue with the error. It is not taken again until it is edited or the queue is started. The queue goes on with the other tasks.

A manual cancel of a run never stops the queue, with or without skip failed. The cancelled run frees its place, the next task takes it, and the run does not go into Skipped. Tasks that depend on the cancelled run are blocked.

## Usage limit

When an agent (`claude`) runs out of its subscription limit, the step stops with the reason `usage limit` and the time the limit resets.

- Until then the daemon starts no step of that agent in any run, so no task is burnt.
- The queue stops (`Stopped: usage limit of claude in <run>, resets 20:50`), with or without skip failed.
- With `--on-limit wait` (the default) the group waits in `queued` (`queued (usage limit, until 20:50)` in `aip run status`). It continues the same step and session after the reset, and the queue starts by itself (`, resumes automatically`). `aip queue pause` cancels the automatic start.
- With `--on-limit stop` the group fails (retry it with `aip run retry`) and the queue waits for `aip queue start`.
- A reset that passed while the daemon was down is picked up when it starts.
- The limit of `opencode` is not recognized.

## When the queue stops

- The queue stops when one of its runs gets a problem: a group in `failed` or `conflict`, or a delivery error (`apply_failed`), or a usage limit. The reason is visible in `aip queue list`.
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

Tags are named colored labels for tasks and runs. Every repository has its own catalog: the same name can exist in two repositories, and a task or run sees only the tags of its repository. `aip tag` works with the repository of the current directory; `-r, --repo <path>` picks another one.

- A name has at most 30 characters and is unique regardless of letter case (Cyrillic included).
- The color is one of ten: `gray`, `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `violet`, `pink`, `brown`. Without `--color`, the next color in turn is used.

```
aip tag add auth --color blue            # create a tag
aip tag list                             # the catalog of the repository (--json)
aip tag edit auth --name login           # rename and/or change the color; tasks and runs keep the tag
aip tag remove login                     # delete the tag and remove it from all tasks and runs
aip queue add feature --task "Login form" --tag auth --tag v2   # --tag can repeat; run start accepts it too
aip queue edit <item> --tag v2           # replaces all tags of the task; --no-tags removes them; with no flags the tags stay
aip queue add feature --task "Follow-up" --parent 115   # link the task to a parent: run id or task number (115 or #115)
aip queue edit <item> --parent 115       # replace the linked task tags of the task with the tag of that run; --no-parent removes them
aip run tag <run-id> auth v2             # add tags to a run in any state, including a finished one
aip run untag <run-id> v2                # remove tags
aip run list --tag auth --tag v2         # runs with at least one of the tags
```

- The tags of a task move to the run when the run is created from the task.
- An unknown tag name rejects the whole request. Create the tag with `aip tag add`.
- Tags appear as `#name` in `aip run list`, `aip run show` and `aip queue list`. In JSON they are a `tags` field with a list of `{id, name, color}`.
- A tag of a linked task (see below) shows as `#name→#N` (the task the tag leads to) and in JSON has `task: {run, number}`; ordinary tags have `task: null`.
- The `swarm_run`, `swarm_queue_add` and `swarm_queue_edit` tools accept an optional `tags` and an optional `parent` (see below); `swarm_queue_edit` also takes `parent: null`. The catalog cannot be managed through MCP.

Tags of tasks that a specialist queues:

- A task that a specialist puts in the queue with `swarm_queue_add` always gets the tag of a linked task of its run first, then all the other tags its run has at that moment.
- A specialist cannot set tags itself.
- When the run has no tag of a linked task yet, the first `swarm_queue_add` creates it and puts it on the run (first) and on the task. Later tasks of the run reuse it, so no second tag appears. A run that has other tags gets its own tag too, so every task shows which task it came from.
- The name of that tag is the name of the run (without a name: the transliterated title, without a title: the run id). It is cut to 30 characters at the last whole word; when the name is taken, `-2`, `-3`, … is added. An existing tag with the same name is not reused.
- That tag is a tag of a linked task: it belongs to the task `N` that created it, has the reserved color `indigo` and shows as `#name→#N` (in the web panel `#N: name`, a link to that task). `aip tag list` has a `TASK` column with `#N`; ordinary tags have `—`.
- `indigo` is not one of the ten colors: `aip tag add --color indigo` and `aip tag edit --color indigo` are refused, and the color of a tag of a linked task cannot be changed. Renaming and removing it work as for any tag.
- Such a tag cannot be set through `tags`: `--tag`, `swarm_run`, `swarm_queue_add`, `swarm_queue_edit` and `aip run tag` refuse it with `tag … belongs to task #N and is set automatically`. `aip queue edit --tag` and `--no-tags` replace only ordinary tags and keep it. `aip run untag` can still remove it.
- Tags of runs that were created before this rule stay ordinary tags.
- When the workflow or `after` of the task is wrong, the call fails and no tag is created.
- Tags added to a run later do not move to tasks that were already queued, except tasks that wait for that run with `after`.

Parent of a task:

- `--parent <run>` of `aip queue add`, `aip queue edit` and `aip run start`, and the `parent` parameter of `swarm_run`, `swarm_queue_add` and `swarm_queue_edit`, link a task to a parent. The value is a run id (of any repository) or a task number of this repository (`115` or `#115`); the id is tried first.
- The task gets the tag of a linked task of that run first, before its other tags. If the run already has such a tag it is reused; otherwise it is created by the rules above and also put on the parent run (first).
- An unknown run or number, and the number of a task that has not started yet, are errors: nothing changes and no tag is created.
- `aip queue edit --parent` (or `parent` of `swarm_queue_edit`) replaces all tags of linked tasks of the task, including those inherited through `after`; `--no-parent` (`parent: null`) removes them. An edit without `parent` leaves them alone. The tag stays in the catalog and on the parent run. A task that returns a run keeps its own task and takes no `parent`.
- `parent` does not make the task wait for the parent: use `after` for that.

Tags of tasks with `after`:

- A task with `after` also gets the tags of its predecessors (queue items or runs), after its own tags.
- When `aip queue edit --after` adds a predecessor, its tags are added to the task even if `--tag` is passed.
- A tag added later to a predecessor is appended to the waiting tasks that depend on it directly or through a chain.
- Removing a tag, removing a link and runs that already exist do not change other tags.
