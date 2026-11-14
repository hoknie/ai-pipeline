# MCP tools

`aip mcp` is an MCP server over stdio. It gives Claude Code and OpenCode the `swarm_*` tools below. Connect it with [`aip setup`](../getting-started/install.md#what-aip-setup-does), or by hand for [Claude Code](claude-code.md#connect-by-hand) and [OpenCode](opencode.md#connect-by-hand).

The server passes requests to the [daemon](../usage/daemon.md) and starts it when it is not running, so every Claude Code and OpenCode window and the terminal see one state.

Without `repo`, a tool works with the repository of the current directory. `repo` is a path or a [project slug](../usage/repositories.md#projects); when the current directory has a file or directory of that name, the path wins. Every answer has a table for humans and the data as JSON. In OpenCode the tools carry the server prefix: `aip_swarm_status`, `aip_swarm_run`.

## Host tools

| Tool | Parameters | What it does |
|---|---|---|
| `swarm_run` | `pipeline`, `task` or `groups[{title, task}]`, `deliveryMode?`, `tags?`, `parent?`, `variant?`, `skip?`, `after?`, `attachments?`, `repo?` | Puts a task at the end of the repository's queue and starts a stopped queue. The answer is `{item, run, queue}`. `run` is the created run, or `null` if the task waits |
| `swarm_status` | `run_id?` | Without `run_id`, the active runs and the 10 latest; with `run_id`, the table of groups |
| `swarm_group` | `run_id`, `group`, `tail_lines?` | Step attempts, verdicts, remarks, tokens and the tail of the log |
| `swarm_cancel` | `run_id`, `group?` | Stops a group or a whole run |
| `swarm_retry` | `run_id`, `group`, `refresh_config?` | Retries a failed or cancelled step from where it stopped, or retries the merge after a conflict. `refresh_config: true` first takes the whole specialists from the current configuration, as `aip group retry --refresh-config` |
| `swarm_skip_step` | `run_id`, `step`, `skip?` | Skips a step that is running or still ahead (`skip=false` brings it back); a running step is stopped without a commit |
| `swarm_answer` | `run_id`, `group`, `answer` | Answers a specialist who is waiting for a human decision |
| `swarm_apply` | `run_id`, `groups?`, `force?` | Delivers ready groups (the command is `aip run apply`) |
| `swarm_mark_delivered` | `run_id`, `groups?` | Marks merged groups as delivered when you merged them by hand (the command is `aip run mark-delivered`) |
| `swarm_queue` | `repo?` | The queue: state, `parallel`, reason for stopping, places taken, waiting tasks in order with their readiness and predecessors, and the runs that hold a place |
| `swarm_queue_add` | `pipeline`, `task` or `groups[{title, task}]`, `title?`, `deliveryMode?`, `tags?`, `parent?`, `variant?`, `skip?`, `after?`, `attachments?`, `postponed?`, `repo?` | Puts a task at the end of the queue; does not start the queue. `postponed: true`: a running queue skips the task until the flag is cleared |
| `swarm_queue_edit` | `item`, `pipeline?`, `task` or `groups?`, `title?`, `deliveryMode?`, `tags?`, `parent?`, `skip?`, `after?`, `postponed?`, `position?`, `repo?` | Changes a waiting task or moves it (1 is first). `deliveryMode: null` follows the config again. `after` and `skip` replace the list, `[]` clears it. A returned run's task takes only `skip` (applied to it), `after`, `position` |
| `swarm_queue_remove` | `item`, `repo?` | Removes a waiting task |
| `swarm_queue_start` | `parallel?`, `repo?` | Starts the queue and continues one that stopped on a problem |
| `swarm_queue_parallel` | `parallel`, `repo?` | Changes the number of simultaneous runs in any queue state |
| `swarm_queue_settings` | `parallel?`, `autopilot?`, `auto_answer?`, `skip_failed?`, `autopilot_answer?`, `on_limit?`, `filter?`, `repo?` | Changes only the passed queue settings (at least one is required). `auto_answer` answers questions with the `autopilot_answer` text (null: default). `on_limit`: `wait` or `stop`. `filter`: `{ pipelines?, tags? }`, set while the queue is stopped |
| `swarm_queue_dismiss` | `run_id`, `repo?` | Removes a skipped run from the skipped list of its queue; the run itself does not change. `repo` defaults to the repository of the run |
| `swarm_queue_return` | `run_id`, `repo?` | Puts a run with failed or cancelled groups back first in its queue; those groups are retried from where they stopped. `repo` defaults to the repository of the run |
| `swarm_run_pause` | `run_id`, `repo?` | Pauses an unfinished run: the running agents are stopped (a step that has already reported finishes and is committed), nothing new starts, and the run moves to the end of the queue as `paused <run-id>`. `swarm_queue_run_now` continues the interrupted step in the same session. `repo` defaults to the repository of the run |
| `swarm_queue_pause` | `repo?` | Stops taking tasks; running runs keep working |
| `swarm_queue_run_now` | `item`, `repo?` | Turns a task into a queue run at once; if no place is free, the last run that took a place is frozen. For a paused or frozen run it is Continue |

- `attachments` of `swarm_run` and `swarm_queue_add` is a list of absolute paths of files the daemon can read (at most 10, each up to 20 MB); see [attachments](../usage/queue.md#attachments). The `swarm_queue_add` of a specialist has no such parameter.
- `parent` of `swarm_run`, `swarm_queue_add` and `swarm_queue_edit` takes a run id or a task number; `null` on edit removes it. See [Parent of a task](../usage/tags.md#parent-of-a-task).
- Queue behaviour, `after` and `skip` are described in [usage/queue.md](../usage/queue.md). Tags are in [usage/tags.md](../usage/tags.md); the tag catalog cannot be managed through MCP.

## Tools of a specialist

Specialists inside a run get their own MCP server (`aip mcp --worker`) with other tools.

| Tool | Available | What it does |
|---|---|---|
| `swarm_report` | Every step | Ends a step with a [verdict](../configuration/pipelines.md#verdicts): `done`, `rejected` or `needs_human`, with `feedback`, `questions` and `human_only` |
| `swarm_artifact` | Every step | Publishes a file of the step as an [artifact](../usage/runs.md#artifacts): `file_name`, `title?`, and `content` or `path` |
| `swarm_run_show` | Every step | Reads a run of the same repository without changing it: `run` (id, task number `#333` or a panel link `…#runs/<id>[/<group>]`), `group?`, `tail_lines?` |
| `swarm_split` | The split step | Proposes the [groups](../configuration/pipelines.md#split) of a task |
| `swarm_queue_add` | A specialist with [`queue: true`](../configuration/specialists.md#queueing-tasks) | Puts a task in the queue of the run's repository: `pipeline`, `task` or `groups`, `title?`, `deliveryMode?`, `variant?`, `skip?`, `after?` |

`swarm_run_show` shows only runs of the repository the specialist's run belongs to; any other run is refused. Without a group it returns the run overview and the full task of every group, with a group (from the parameter or from the link) every attempt of the group and the tail of its latest log.

`swarm_queue_add` of a specialist works with the repository of the run, not with the directory where the specialist works. The task always gets the [linked task tag](../usage/tags.md#tags-of-tasks-a-specialist-queues) of its run. A predecessor id from an earlier answer keeps working after that item has started, because it then points to its run.

## Run data

The JSON of a run carries these fields; they are described in [Run states](../usage/runs.md#run-states):

- `state`, `finished`, `waiting`, `queueItem` and `deliveryStage` of a run;
- `status` and `wait` of a group.

To tell whether a run is unfinished, use the `finished` field, not `state === 'active'`: a run waiting for an answer is not finished either.
