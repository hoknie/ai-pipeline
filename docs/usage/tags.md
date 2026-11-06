# Tags

Tags are named colored labels for [tasks](queue.md) and [runs](runs.md). Every repository has its own catalog: a name can exist in two repositories, and a task or run sees only the tags of its repository. `aip tag` works with the repository of the current directory; `-r, --repo <path>` picks another one.

The labels of specialists and workflows are a separate thing: see [configuration/specialists.md](../configuration/specialists.md#tags) and [configuration/workflows.md](../configuration/workflows.md#workflow-fields).

## Managing tags

```
aip tag add auth --color blue            # create a tag
aip tag list                             # the catalog of the repository (--json)
aip tag edit auth --name login           # rename and/or change the color; tasks and runs keep the tag
aip tag remove login                     # delete the tag and remove it from all tasks and runs
aip queue add feature --task "Login form" --tag auth --tag v2   # --tag can repeat; run start accepts it too
aip queue edit <item> --tag v2           # replaces all tags of the task; --no-tags removes them; with no flags the tags stay
aip run tag <run-id> auth v2             # add tags to a run in any state, including a finished one
aip run untag <run-id> v2                # remove tags
aip run list --tag auth --tag v2         # runs with at least one of the tags
```

- A name has at most 30 characters and is unique regardless of letter case (Cyrillic included).
- The color is one of ten: `gray`, `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `violet`, `pink`, `brown`. Without `--color`, the next color in turn is used.
- The tags of a task move to the run when the run is created from the task.
- An unknown tag name rejects the whole request. Create the tag with `aip tag add`.
- Tags appear as `#name` in `aip run list`, `aip run show` and `aip queue list`. In JSON they are a `tags` field with a list of `{id, name, color}`.
- The `swarm_run`, `swarm_queue_add` and `swarm_queue_edit` tools accept an optional `tags` and an optional `parent`; `swarm_queue_edit` also takes `parent: null`. The catalog cannot be managed through MCP.

In the panel the catalog is the ["Tags" group](../web/settings.md#project-groups) of the project settings.

## Linked task tags

A linked task tag ties tasks to the task they came from. It belongs to the task `N` that created it, and `aip` manages it by itself.

- It shows as `#name→#N`, and in the web panel as `#N: name`, a link to that task. In JSON it has `task: {run, number}`; ordinary tags have `task: null`.
- `aip tag list` has a `TASK` column with `#N`; ordinary tags have `—`.
- Its color is the reserved `indigo`, which is not one of the ten colors: `aip tag add --color indigo` and `aip tag edit --color indigo` are refused, and the color of such a tag cannot be changed. Renaming and removing it work as for any tag.
- It cannot be set through `tags`: `--tag`, `swarm_run`, `swarm_queue_add`, `swarm_queue_edit` and `aip run tag` refuse it with `tag … belongs to task #N and is set automatically`.
- `aip queue edit --tag` and `--no-tags` replace only ordinary tags and keep it. `aip run untag` can remove it.
- Its name is the name of the run (without a name: the transliterated title, without a title: the run id). It is cut to 30 characters at the last whole word; when the name is taken, `-2`, `-3`, … is added. An existing tag with that name is not reused.

### Tags of tasks a specialist queues

- A task that a specialist puts in the queue with `swarm_queue_add` always gets the linked task tag of its run first, then all the other tags its run has at that moment.
- A specialist cannot set tags itself.
- When the run has no linked task tag yet, the first `swarm_queue_add` creates it and puts it on the run (first) and on the task. Later tasks of the run reuse it. A run that has other tags gets its own tag too, so every task shows which task it came from.
- When the workflow or `after` of the task is wrong, the call fails and no tag is created.
- Tags added to a run later do not move to tasks that were already queued, except tasks that wait for that run with `after`.

### Parent of a task

`--parent <run>` of `aip queue add`, `aip queue edit` and `aip run start`, and the `parent` parameter of `swarm_run`, `swarm_queue_add` and `swarm_queue_edit`, link a task to a parent.

```
aip queue add feature --task "Follow-up" --parent 115   # link the task to a parent: run id or task number (115 or #115)
aip queue edit <item> --parent 115       # replace the linked task tags of the task with the tag of that run; --no-parent removes them
```

- The value is a run id (of any repository) or a task number of this repository; the id is tried first.
- The task gets the linked task tag of that run first, before its other tags. If the run has no such tag, it is created by the rules above and also put on the parent run (first).
- An unknown run or number, and the number of a task that has not started yet, are errors: nothing changes and no tag is created.
- `aip queue edit --parent` (or `parent` of `swarm_queue_edit`) replaces all linked task tags of the task, including those inherited through `after`; `--no-parent` (`parent: null`) removes them. An edit without `parent` leaves them alone. The tag stays in the catalog and on the parent run.
- A task that returns a run keeps its own task and takes no `parent`.
- `parent` does not make the task wait for the parent: use [`after`](queue.md#dependencies) for that.

## Tags of tasks with `after`

- A task with `after` also gets the tags of its predecessors (queue items or runs), after its own tags.
- When `aip queue edit --after` adds a predecessor, its tags are added to the task even if `--tag` is passed.
- A tag added later to a predecessor is appended to the waiting tasks that depend on it directly or through a chain.
- Removing a tag, removing a link and runs that already exist do not change other tags.
