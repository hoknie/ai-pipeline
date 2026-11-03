# Connecting to Claude Code and OpenCode

`aip mcp` is an MCP server over stdio. It passes requests to the `aip` daemon and starts the daemon if it is not running. All Claude Code and OpenCode windows and the terminal see the same state. To control the daemon, see [cli.md](cli.md#daemon).

`aip setup` connects everything below by itself: it registers the MCP server in Claude Code and OpenCode and installs the Claude Code plugin (see [install.md](install.md)). The manual steps stay here for the cases when you cannot or do not want to run it.

## Claude Code

```sh
claude mcp add --scope user aip -- aip mcp
```

To check, run `claude mcp list` in a new session. It shows `aip`, and the tool list has `swarm_*`. To attach the server to a single session without registering it:

```sh
claude --mcp-config '{"mcpServers":{"aip":{"type":"stdio","command":"aip","args":["mcp"]}}}'
```

## The aip panel in Claude Code

The `integrations/claude-code` plugin (the "mod") lets you control the swarm in the Claude Code window. The panel does not open by itself: `/aip:panel` opens it and `/aip:panel close` closes it.

### What the panel shows

The header is `aip · 2 active · 1 needs you`, with a connection indicator: `● live` for the event stream, `◌ polling` for polling, `✕ offline` when aip is not found.

- **Needs you.** A frame under the header. The questions of the selected run are expanded in it, with the text, the options and an answer field. Other things that wait for you (questions of other runs, a conflict, a failure, a rejected delivery) are one-line items, at most five, the rest collapse into `+N more`. With nothing to decide, the frame is hidden.
- **Runs.** Active runs first, finished ones dimmed, the selected one marked with `›`. A row has a status icon, the title (the `id` if there is none), a progress bar `▰▰▰▰▰▰▱▱▱▱ 3/5`, the age and the cost. The keys `1`–`8` select the first eight runs.
- **The selected run.** The title with a status icon, and "cancel run" and "apply run" buttons when they make sense. One line shows `id · workflow · phase · diff · delivery · cost`. Below are the groups, ordered by urgency: waiting for you, failed and conflicting, running, queued, merged and cancelled.
- **A group.** An icon and a status label, the step, round, time, diff and delivery, and the failure reason as the first line.
- **A group's question.** If the agent asked structured questions, each one has buttons with options and a field for your own answer. The recommended option is marked `recommended` and is put in the field by default. "answer" sends all the answers as one text, `Q1: …` / `A1: …`. While some question has no answer, the panel names its number and sends nothing.
- **Buttons.** "retry" for a failed group and a group with a conflict, "cancel" for a group in progress, "apply" for a merged group that is not delivered yet. For a run with a single group, cancel and apply are shown only on the run.
- **Result of an action.** One line under the header. `✓ …` disappears after 8 seconds, `✕ …` stays until the next action.

The status icons are `○` queued, `◐` running, `?` waiting for you, `⇄` merging, `●` merged, `⚠` conflict, `✕` failure, `⊘` cancelled. Colors come from the Claude Code theme.

The panel updates from the `aip events --json` stream. If the stream breaks, it polls every 2 seconds and reconnects by itself.

### Status line

The status line shows the state through the whole session:

- `aip: idle`, `aip: connecting`, `aip: offline`;
- `aip: Add login · 2 running · 1 question` for one active run (a title over 30 characters is cut);
- `aip: 2 runs · 1 running · 1 failed` for several.

The counters `running`, `question(s)`, `failed` and `conflict` are shown only when they are not zero.

### Notifications

A notification appears once for each event: a group waits for an answer, fails or gets a conflict, a run finishes, a delivery is rejected.

### Commands

- `/aip:run <workflow> <task>` starts a run in the repository of the current session;
- `/aip:status [run-id]` lists the runs (icon, title, `id`, `3/5`, diff, cost) or the groups of one run, in Markdown;
- `/aip:apply <run-id> [group...] [--force]` delivers a run;
- `/aip:panel` opens the panel, `/aip:panel close` closes it;
- `/aip:web [start|stop|restart|status] [--port <n>]` manages `aip web` for the session's repository.

The plugin draws `swarm_*` tool calls in the chat as one line, for example `aip · status — 1 active: Add login 3/5 · 1 needs answer`. The text the model receives does not change, and Ctrl+O shows the full output.

### `/aip:web`

- With no arguments (or `start`) it starts `aip web` and replies with the link `aip web: http://127.0.0.1:7341/?token=…`.
- A second `start` returns the same link. `status` shows it, or "aip web is not running.". `stop` stops the server.
- The server lives while the Claude Code session is open.
- After `restart` the token is new and the port stays the same.
- Ports, the daemon's panel and `stop` are described in [web.md](web.md#open-the-panel).

### Installation

`aip setup` installs the plugin from the marketplace in the package. Without npm, run this in Claude Code:

```
/plugin marketplace add hoknie/ai-pipeline
/plugin install aip@aip
```

To load the plugin from the repository folder without installing it:

```sh
claude --plugin-dir /path/to/ai-pipeline/integrations/claude-code
```

To load it in every session, add the folder to `env` in `~/.claude/settings.json`:

```json
{
  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/ai-pipeline/integrations/claude-code" }
}
```

The MCP server is connected separately (`claude mcp add`, above).

### The path to aip

The plugin calls `aip` from `PATH`. If the command is not installed through `npm link` (for example, Node is installed through nvm), give the path in the plugin option `aipCommand`, in the plugin settings menu or in `~/.claude/settings.json`:

```json
{
  "pluginConfigs": {
    "aip": {
      "options": {
        "aipCommand": ["/path/to/node", "/path/to/ai-pipeline/dist/cli/main.js"]
      }
    }
  }
}
```

If `aip` is not found, the panel and the status line show an error with a hint about `aipCommand`.

## OpenCode

Add the server to `~/.config/opencode/opencode.json` (or to the project's `opencode.json`):

```json
{
  "mcp": {
    "aip": { "type": "local", "command": ["aip", "mcp"], "enabled": true }
  }
}
```

To check, run `opencode mcp list`. It shows `aip`.

### Verified

Checked against OpenCode 1.18.35 on a live model (a free OpenRouter model), with a throwaway repository and a separate `XDG_CONFIG_HOME` and `XDG_STATE_HOME`:

- `opencode mcp list` prints `aip` as `connected` for the configuration above.
- From `opencode run --format json`, the model called `swarm_status` (answer: `No runs yet.`) and `swarm_run` (the run was started, reached `merged` and was delivered); `swarm_status` then showed the run as `finished`. In OpenCode the tools are named with the server prefix: `aip_swarm_status`, `aip_swarm_run`.
- The agent that `aip` generates is applied: `bash` outside `allow_commands` is refused (the tool event has `status: error` with the text of the rule), allowed commands run, and `-s <session>` continues the same session (the model remembers the first request).
- A workflow whose `coder` has `runtime: opencode` goes through `code` to `merged`; the specialist reports with `aip_swarm_report`, and `aip group show` prints the OpenCode log of the step with its tokens.

If `opencode run` prints nothing for minutes, the cause is usually not the model but a global MCP server in your own OpenCode configuration that does not start or needs authorization: disable such servers (`"enabled": false`) or check them with `opencode mcp list`. A failed request ends with an `error` event; `aip` shows its `data.message` as the reason of the step.

## Tools

| Tool | Parameters | What it does |
|---|---|---|
| `swarm_run` | `workflow`, `task` or `groups[{title, task}]`, `deliveryMode?`, `tags?`, `skip?`, `after?`, `repo?` | Puts a task at the end of the repository's queue and starts a stopped queue. The answer is `{item, run, queue}`. `run` is the created run, or `null` if the task waits |
| `swarm_status` | `run_id?` | Without `run_id`, the active runs and the 10 latest; with `run_id`, the table of groups |
| `swarm_group` | `run_id`, `group`, `tail_lines?` | Step attempts, verdicts, remarks, tokens and the tail of the log |
| `swarm_cancel` | `run_id`, `group?` | Stops a group or a whole run |
| `swarm_retry` | `run_id`, `group` | Retries a failed or cancelled step from where it stopped, or retries the merge after a conflict |
| `swarm_answer` | `run_id`, `group`, `answer` | Answers a specialist who is waiting for a human decision |
| `swarm_apply` | `run_id`, `groups?`, `force?` | Delivers ready groups (the command is `aip run apply`) |
| `swarm_queue` | `repo?` | The queue: state, `parallel`, reason for stopping, places taken, waiting tasks in order with their readiness and predecessors, and the runs that hold a place |
| `swarm_queue_add` | `workflow`, `task` or `groups[{title, task}]`, `title?`, `deliveryMode?`, `tags?`, `skip?`, `after?`, `postponed?`, `repo?` | Puts a task at the end of the queue; does not start the queue. `postponed: true` makes a running queue skip the task until the flag is cleared |
| `swarm_queue_edit` | `item`, `workflow?`, `task` or `groups?`, `title?`, `deliveryMode?`, `tags?`, `skip?`, `after?`, `postponed?`, `position?`, `repo?` | Changes a waiting task or moves it (1 is first). `deliveryMode: null` follows `delivery.mode` again. `after` and `skip` replace the whole list, `[]` clears it |
| `swarm_queue_remove` | `item`, `repo?` | Removes a waiting task |
| `swarm_queue_start` | `parallel?`, `repo?` | Starts the queue and continues one that stopped on a problem |
| `swarm_queue_parallel` | `parallel`, `repo?` | Changes the number of simultaneous runs in any queue state |
| `swarm_queue_settings` | `parallel?`, `autopilot?`, `skip_failed?`, `autopilot_answer?`, `on_limit?`, `repo?` | Changes only the passed queue settings (at least one is required). `autopilot_answer: null` restores the default. `on_limit` is `wait` (the group waits for the usage limit to reset and the queue starts again by itself) or `stop` (the group fails and the queue waits for a start) |
| `swarm_queue_return` | `run_id`, `repo?` | Puts a run with failed or cancelled groups back first in its queue; those groups are retried from where they stopped. `repo` defaults to the repository of the run |
| `swarm_queue_pause` | `repo?` | Stops taking tasks; running runs keep working |
| `swarm_queue_run_now` | `item`, `repo?` | Turns a task into a queue run at once, beyond the limit |

Without `repo`, the repository of the current directory is used. The queue, its settings, `after` and `skip` are described in [queue.md](queue.md). Every answer has a table for humans and the same data as JSON.

### Tools of a specialist

Specialists inside a run get their own MCP server (`aip mcp --worker`) with other tools:

- `swarm_report` reports the result of a step.
- `swarm_split` is available only on the split step.
- `swarm_queue_add` (`workflow`, `task` or `groups`, `title?`, `deliveryMode?`, `skip?`, `after?`) is available only to a specialist with `queue: true`.
- It puts the task in the queue of the run's repository, not of the directory where the specialist works.
- The task gets tags automatically (see [Tags](queue.md#tags)).
- A predecessor id from an earlier `swarm_queue_add` answer keeps working after that item has started, because it then points to its run.

### Run state

`state` in JSON and the `STATE` column in `aip run list`:

- `needs_human`: at least one group (including the split, the commit message and the resolver) waits for a human's answer;
- `active`: work is in progress;
- `finished`: everything is complete;
- `failed`: the split step or a work group failed, or the delivery of a merged group ended in `apply_failed`. The state is recalculated after a retry or a successful delivery;
- `cancelled`: the run was cancelled. This takes precedence over `failed`.

A queued group that the scheduler holds back has the status `waiting`.
Its `wait` object has `reason` (`specialist`, `capacity` or `limit`) and the details of the reason; `wait` is `null` for other groups.

`deliveryStage` in the data of a run is `null` or an object with `status` (`pending`, `delivering`, `applied`, `apply_failed`).
With `apply_failed` it also has the `reason` of the first failed group and their slugs in `groups`.

The `waiting` field is the number of waiting groups. To tell whether a run is unfinished, use the `finished` field, not `state === 'active'`: a waiting run is not finished either.

## Web panel

The browser panel is described in [web.md](web.md).

## Multiple repositories

One daemon and one state database (`$XDG_STATE_HOME/aip/`, `~/.local/state/aip/` by default) serve all repositories. The shared configuration (`$XDG_CONFIG_HOME/aip/`) is common too. Each repository has its own project configuration (`aip/`), queue and working files in `.aip/`.

- **The list of repositories.** The daemon keeps it in its database. A repository joins on the first request that touches it (`aip run`, `aip queue …`, the "Queue", "Topology", "Specialists" and "Workflow" sections of the panel), or through `aip repo add`. Runs and queues created before the list existed join it on upgrade.
- **Listing and removing.** `aip repo list` shows the unfinished runs, runs waiting for an answer and queued tasks of each repository. `aip repo remove <path>` removes the entry and keeps runs and the queue. It refuses while there are unfinished runs or queued tasks. A removed repository returns on the next request that names it.
- **`aip config check`** works without the daemon and does not change the list.
- **CLI.** `--repo <path>` exists on `aip run start`, `aip queue …` and `aip config check`. By default it is the current directory. Commands that take a run id work from any directory, and `aip run list` shows the runs of all repositories.
- **MCP and the plugin.** `swarm_run` and `swarm_queue*` have `repo?`. `/aip:run` starts a workflow in the repository of the Claude Code session. The session's directory does not affect which repository the panel selects.
- **Limits.** The daemon has one global limit: `max` of the most recently started run. A specialist's `max` is counted by its slug across all runs, so a specialist in a second repository may wait for one in the first.
- **Web panel.** One panel serves all repositories: pick the repository in it (see [web.md](web.md)). `aip web --port 7342` is only for a separate panel with its own token.

```sh
cd ~/projects/app && aip run start feature --task "..."
cd ~/projects/site && aip run start feature --task "..."
aip queue add feature --task "..." --repo ~/projects/site   # the queue of another repository
aip queue start --repo ~/projects/site
aip run list                          # runs of both repositories
aip repo list                       # the daemon's repositories with counters
aip repo add ~/projects/new         # add a repository before its first run
aip repo remove ~/projects/old      # remove from the list
cd ~/projects/site && aip web --port 7342
```
