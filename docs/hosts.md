# Connecting to Claude Code and OpenCode

`aip mcp` is an MCP server over stdio. It passes requests to the `aip` daemon and starts the daemon itself if it is not running. All Claude Code and OpenCode windows and the terminal see the same state. The daemon can be controlled from a terminal: `aip daemon start|stop|restart|status`. `stop` and `restart` refuse (code 1) while agents work unless `--force` is given; `status [--json]` exits with code 3 when no daemon runs.

`aip setup` connects everything below by itself: it registers the MCP server in Claude Code and OpenCode and installs the Claude Code plugin (see [install.md](install.md)). The manual steps stay here for the cases when you cannot or do not want to run it.

## Claude Code

```sh
claude mcp add --scope user aip -- aip mcp
```

To check, run `claude mcp list` in a new session: it shows `aip`, and the tool list has `swarm_*`. Without registering the server, you can attach it to a single session:

```sh
claude --mcp-config '{"mcpServers":{"aip":{"type":"stdio","command":"aip","args":["mcp"]}}}'
```

## The aip panel in Claude Code

The `integrations/claude-code` plugin (the "mod") lets you control the swarm right in the Claude Code window:
- **The "aip" panel** next to the chat. At the top is a header such as `aip · 2 active · 1 needs you` and a connection indicator (`● live` for the event stream, `◌ polling` for polling, `✕ offline` when aip is not found). Below it:
  - **"Needs you"** is a frame right under the header (and under the line with the result of an action). The questions of the selected run are expanded in it: a frame with the text, the options and an answer field, and an "answer" button below. Everything else that waits for your decision (questions of other runs, a merge conflict, a failure, a rejected delivery) is shown as one-line items: at most five, the rest collapse into `+N more`. Clicking an item selects the run and expands its question. If there is nothing to decide, the frame is not shown. The "N need you" counter in the header counts the same cases;
  - **"Runs"** lists active runs first, finished ones dimmed, and the selected one is marked with `›`. A row has a status icon, the run title (the `id` if there is none), a progress bar `▰▰▰▰▰▰▱▱▱▱ 3/5`, the age and the cost. The first eight runs are selected with the keys `1`–`8`, and the rest collapse into `+N more`;
  - **The selected run**: a title with a status icon and the name, and on the right the "cancel run" and "apply run" buttons when they make sense. One line shows `id · workflow · phase · diff · delivery · cost`. Below it are the groups, ordered by urgency (waiting for you, failed and conflicting, running, queued, merged and cancelled). A group has a line with an icon and a status label, a line with the step, round, time, diff and delivery, and the failure reason as the first line;
  - **A group's question** sits in a frame. If the agent asked structured questions, each one has its own buttons with options (the recommended one is marked `recommended` and is put in the field by default) and a field for your own answer. "answer" sends all the answers as one text, `Q1: …` / `A1: …`. While some question has no answer, the panel names its number and sends nothing;
  - **Buttons** appear only when they make sense for the status: "retry" for a failed group and a group with a conflict, "cancel" for a group in progress, "apply" for a merged group that is not delivered yet. Delivered and cancelled groups have no buttons. For a run with a single group, cancel and apply are shown only on the run. The result of an action is one line under the header: `✓ …` disappears after 8 seconds, `✕ …` stays until the next action. While an action is running, the button shows `…`, and pressing it again does not start it twice.

  Colors come only from the Claude Code theme, so the panel reads well on both light and dark themes. You can also read a status from its icon: `○` queued, `◐` running, `?` waiting for you, `⇄` merging, `●` merged, `⚠` conflict, `✕` failure, `⊘` cancelled. If the window is narrower than 100 columns, a group takes one line, `● login · code · r1 · 1m05s`, and run rows have no progress bar, age or cost; questions stay expanded;
- **The status line** is visible throughout the session: `aip: idle` with no active runs, `aip: connecting` while connecting, `aip: offline` after a polling error, `aip: Add login · 2 running · 1 question` for one active run (a title longer than 30 characters is cut), `aip: 2 runs · 1 running · 1 failed` for several. The counters `running`, `question(s)`, `failed` and `conflict` are shown only when they are not zero;
- **Notifications** for these events: a group waits for an answer, fails or gets a conflict, a run finishes, a delivery is rejected. Each notification is shown once;
- **Commands**:
  - `/aip:run <workflow> <task>` starts a run in the repository of the current session;
  - `/aip:status [run-id]` shows the list of runs (one line per run: icon, title, `id`, `3/5`, diff, cost) or the groups of one run, in Markdown;
  - `/aip:apply <run-id> [group...] [--force]` delivers a run;
  - `/aip:panel` opens the panel, and `/aip:panel close` closes it;
  - `/aip:web [start|stop|restart|status] [--port <n>]` manages the `aip web` server for the session's repository.

The plugin draws the `swarm_*` tool calls in the chat as one line, for example `aip · status — 1 active: Add login 3/5 · 1 needs answer`. The text that the model receives does not change. Ctrl+O shows the full output. A failed call and output that could not be parsed are drawn as they would be without the plugin.

The panel updates from the `aip events --json` stream. If the stream breaks, it switches to polling every 2 seconds and reconnects by itself.

### Installation

`aip setup` installs the plugin from the marketplace in the package. Without npm, run this in Claude Code:

```
/plugin marketplace add hoknie/ai-pipeline
/plugin install aip@aip
```

As a fallback, load the plugin from the repository folder, without installing it:

```sh
claude --plugin-dir /path/to/ai-pipeline/integrations/claude-code
```

To load the plugin in every session, add the folder to `env` in `~/.claude/settings.json`:

```json
{
  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/ai-pipeline/integrations/claude-code" }
}
```

The MCP server is connected separately, as described above (`claude mcp add`).

### The path to aip

By default the plugin calls `aip` from `PATH`. If the command is not installed through `npm link` (for example, Node is installed through nvm), give the path in the plugin option `aipCommand`: in the plugin settings menu or in `~/.claude/settings.json`:

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

The panel does not open by itself: `/aip:panel` opens it and `/aip:panel close` closes it.

`/aip:web` with no arguments (or `start`) starts `aip web` and replies with a link like `aip web: http://127.0.0.1:7341/?token=…`. A second `start` returns the same link, `status` shows it or "aip web is not running.", and `stop` stops the server. The server lives as long as the Claude Code session is open and stops when you exit. After `restart` the link is new (the token changes) and the port stays the same. If port 7341 is busy (another session, or `aip web` in a terminal), the command fails with `port 127.0.0.1:7341 is already in use, maybe by another aip web: …`. The panel may already be running: open it and pick the repository there, or give another port with `--port`. If the daemon holds the panel (`web.autostart`, the default), `aip web` prints its link and exits with code 0, and `/aip:web` replies with that link. `stop` then replies that the panel belongs to the daemon and stops together with it (or set `web.autostart: false`).

## OpenCode

Add the server to `~/.config/opencode/opencode.json` (or to the project's `opencode.json`):

```json
{
  "mcp": {
    "aip": { "type": "local", "command": ["aip", "mcp"], "enabled": true }
  }
}
```

To check, run `opencode mcp list`: it shows `aip`.

## Tools

| Tool | Parameters | What it does |
|---|---|---|
| `swarm_run` | `workflow`, `task` or `groups[{title, task}]`, `tags?`, `skip?`, `after?`, `repo?` | Puts a task at the end of the repository's queue and starts a stopped queue. `after` is a list of ids of queue items or runs of the repository that must be done first; if one of them is not done, `run` is `null` and the task waits in the queue. Without `repo`, the repository of the current directory is used. The answer is `{item, run, queue}`: `run` is the created run, or `null` if the task is waiting for a place |
| `swarm_status` | `run_id?` | Without `run_id`, the active runs and the 10 latest; with `run_id`, the table of groups |
| `swarm_group` | `run_id`, `group`, `tail_lines?` | Step attempts, verdicts, remarks, tokens and the tail of the log |
| `swarm_cancel` | `run_id`, `group?` | Stops a group or a whole run |
| `swarm_retry` | `run_id`, `group` | Retries a failed or cancelled step from where it stopped, or retries the merge after a conflict |
| `swarm_answer` | `run_id`, `group`, `answer` | Answers a specialist who is waiting for a human decision |
| `swarm_queue` | `repo?` | The repository's task queue: state, `parallel`, reason for stopping, places taken, waiting tasks in order (each with its readiness `ready`, `waiting` or `blocked` and its predecessors with their state), and the runs that hold a place, with workflow, progress by group and by step (`steps` with `done`, `total` and, for a single group, `current`), active steps and problem |
| `swarm_queue_add` | `workflow`, `task` or `groups[{title, task}]`, `title?`, `tags?`, `skip?`, `after?`, `repo?` | Puts a task at the end of the queue; does not start the queue |
| `swarm_queue_edit` | `item`, `workflow?`, `task?` or `groups?`, `title?`, `tags?`, `skip?`, `after?`, `position?`, `repo?` | Changes a waiting task or moves it to a position (1 is first); `after` replaces the whole list of predecessors and `[]` clears it |
| `swarm_queue_remove` | `item`, `repo?` | Removes a waiting task |
| `swarm_queue_start` | `parallel?`, `repo?` | Starts the queue and continues one that stopped on a problem |
| `swarm_queue_parallel` | `parallel`, `repo?` | Changes the number of simultaneous runs in any queue state; tasks start at once, and running runs are not interrupted |
| `swarm_queue_pause` | `repo?` | Stops taking tasks; running runs keep working |
| `swarm_queue_run_now` | `item`, `repo?` | Turns a task into a queue run at once, beyond the limit; the run takes a place (for example, 3 of 2) |

Specialists inside a run get their own MCP server (`aip mcp --worker`) with a different set of tools. `swarm_report` reports the result of a step. `swarm_split` is available only on the split step. `swarm_queue_add` (`workflow`, `task` or `groups`, `title?`, `skip?`, `after?`) is available only to a specialist with `queue: true`. This `swarm_queue_add` puts the task in the queue of the run's repository, not of the directory where the specialist works, and with the same tags as its run (a specialist cannot set tags itself). `skip` is a list of workflow step ids the task skips, e.g. `["review", "qa"]`; in `swarm_queue_edit` it replaces the whole list and `[]` clears it.

`after` makes a chain of tasks. A predecessor is an id of a queue item (`q…`) or of a run of the same repository; an id that a specialist got from an earlier `swarm_queue_add` answer keeps working after that item has started, because it then points to its run. A predecessor is done when its run is finished and all its groups are merged and delivered to the working tree (with `delivery.auto: false`, only after `aip run apply`). A task whose predecessors are not done is `waiting`; if a predecessor failed, conflicted, was cancelled, failed to apply or no longer exists, the task is `blocked`. The queue skips tasks that are not ready and takes the next ready ones, so an independent task can start before a dependent one. A task that is blocked or waiting never makes the queue stop, and a retry of the predecessor makes the task ready again, but a queue stopped on the problem starts again only with `swarm_queue_start`. `swarm_queue_run_now` starts a waiting or blocked task regardless. An unknown id, a reference to the task itself and a cycle are errors.

Run state (`state` in JSON, the `STATE` column in `aip run list`):
- `needs_human`: at least one group (including the split, the commit message and the resolver) is waiting for a human's answer;
- `active`: work is in progress;
- `finished`: everything is complete;
- `failed`: the run is complete, but the split step or a work group failed, or the delivery of a merged group ended in `apply_failed` (the state is recalculated after a retry or a successful delivery);
- `cancelled`: the run was cancelled (this takes precedence over `failed`).

The number of waiting groups is the `waiting` field. Use the `finished` field to tell whether a run is unfinished, not `state === 'active'`: a waiting run is not finished either.

Every answer contains a table for humans and the same data as JSON.

## Web panel

By default the `aip` daemon itself starts the panel: the daemon starts on any `aip` command and keeps the panel on `127.0.0.1:7341` while it runs. The token is stored in `web.json` in the state directory and survives a daemon restart, so the link does not change. `AIP_WEB_TOKEN` in the daemon's environment sets a token of your own. In this case `aip web` does not start a second server: it prints the daemon panel's link (`aip web: http://127.0.0.1:7341/?token=…`, then `aip web: served by the aip daemon (pid N)`) and exits with code 0. `/aip:web` and `just web` (`scripts/aip-web.sh`) behave the same way: `start` and `status` reply with the link, and `stop` says that the panel belongs to the daemon. Requests to the daemon's panel without a `repository` parameter refer to the most recently added repository. While there are no repositories, the panel offers "Add repository…".

The settings are in the `web` section of the shared `settings.yaml` (see `docs/configuration.md`). `autostart: false` or `AIP_WEB_AUTOSTART=0` turn autostart off, and then `aip web` works the old way: its own server until Ctrl+C. `auth: none` removes the token: the link has no `?token=`, and the page and the API are open to any local process; the `Host`/`Origin` check stays. `aip web --port <n>` on another port starts a server of its own.

The panel of the daemon is controlled by subcommands, like the daemon itself:

```
aip web start [--open]      # start the daemon if needed and raise the panel, even with autostart: false
aip web stop                # stop the panel only; the daemon and its agents keep running
aip web restart [--open]    # stop and raise again, re-reading the web section; the token is kept
aip web status [--json]     # running (pid N), url, address, auth; exit code 3 when it does not run
```

The pid is the daemon's pid (the panel has no process of its own). `AIP_WEB_TOKEN` of the `start` or `restart` command sets the token of the new panel. If the port is busy or the `web` section has an error, the command exits with code 1 and the daemon keeps working; `status` then shows the `reason`. A panel stopped by `aip web stop` stays stopped until `aip web start`, `aip web restart` or the next start of the daemon. `status` and `stop` never start the daemon.

`aip web` starts a local panel in the browser and prints a link like `http://127.0.0.1:7341/?token=…`. The token is random and changes on every start of its own server. Without the token the panel answers 401 (except with `web.auth: none`).

```
aip web [--port <n>] [--host <addr>] [--open]   # defaults: web.port and web.host: 7341, 127.0.0.1
```

- The panel sections ("Runs", "Queue", "Topology", "Specialists", "Workflow") are in one strip across the top of the window: the name and the repository picker on the left, the sections in the middle, search, notifications, language, theme and the connection indicator on the right. Below 1024 px the sections and the search show icons only (the name is in a tooltip), and in a window narrower than 768 px the strip is replaced by a bar with a "Menu" button that opens the same navigation in a sliding panel. On the icon of "Runs" is a counter of runs in progress (unfinished); if some of them wait for an answer, the counter is highlighted and its name tells how many. On the icon of "Queue" is the number of queued tasks. Pages use the whole width of the window.
- In the strip is a repository picker. It lists the directory (the full path in a tooltip) of every repository in the daemon's list (see "Multiple repositories") and only those: the directory where `aip web` was started does not affect the list. The "Add repository…" item opens a dialog with a "Path" field. A path inside a git repository (a subdirectory is resolved to the root) is added to the list and selected at once, and a daemon error stays in the dialog. Every item except the default repository (the most recently added one) has a "Remove from list" action (after confirmation). If the repository has unfinished runs or queued tasks, the daemon refuses, and the panel shows a notification. If the selected repository is removed, the selection returns to the default repository. The default repository opens first, then the choice is remembered in the browser. If the remembered repository is no longer in the list, the default one is selected. "Queue", "Topology", "Specialists", "Workflow" and the command palette work with the selected repository. Other repositories that have runs waiting for an answer get a counter in the list. An unsaved specialist or workflow form asks for confirmation before the repository is switched. The address `#runs/<run-id>` of a run from another repository, and a jump to "Topology" from such a run, switch the selection to the run's repository.
- `GET /api/repositories` returns the list of repositories with counters, `POST /api/repositories` with the body `{"path": "<absolute path>"}` adds a repository, and `DELETE /api/repositories?repository=<absolute path>` removes one. A relative path is rejected with code 400 without contacting the daemon, and daemon errors also come back with code 400 and the error text. The list and its changes also arrive in `/api/events` (the `repositories` event).
- The queue requests, `/api/config…` and `/api/workflows` accept the parameter `repository=<absolute path>`. Without it the most recently added repository of the registry is used, wherever `aip web` was started (while the registry is empty, the answer is 409). A relative path and a path outside a git repository are rejected with code 400. A `repository` field in the request body is ignored.
- "Runs" has three columns from 1280 px: the filters, the list of runs and the open run. Below 1280 px the filters are behind a "Filters" button above the list (with the number of filters in effect), and in a phone-wide window they open in a sliding panel. The filters are a "This repository / All repositories" switch (the first is the default; in "All" mode each card is labeled with its repository, and the "Runs" counter in the strip counts in the same mode), a search (by title, name, workflow, id and group titles) and a filter "All / Waiting / Active / Finished" with counters. Cancelled runs go under "Finished". The list shows run cards. A run card shows the first line of the task, the status, workflow, time, cost and a summary of changes (`2 files +367 −0`). A run from the queue has a "from the queue" mark. Under the selected run with several groups the list of groups is expanded; if there is only one group, it is opened on the right at once. In a narrow window you see either the list or the run, with a "Back to the list" button.
- Runs waiting for an answer come first in the list, then the other unfinished ones, then finished ones; within each part, newer runs are on top. If two or more groups wait, the run gets a "Waiting ×N" label.
- "Queue" has a controls column on the left from 1024 px (the state, "Start", "Pause" and the parallelism; above the content on a narrower window). The running runs are cards in a grid of two (three from 1536 px), then come the waiting tasks and the new task form. In the "Specialists" and "Workflow" tabs the form takes the whole width next to the list.
- In "Queue", the task forms (new and edit) have a "Waits for" field, a searchable multiselect of the waiting tasks (except the edited one), the queue's runs and, when editing, the current predecessors, so a predecessor that no longer holds a place can still be removed. An edit sends the list only if the field was changed; removing every predecessor sends an empty list. A refused reference (a cycle, the task itself) is shown at the form and the choice is kept. Each row shows an "after: …" label per predecessor (a run's label links to the run) with an icon and text for its state (done, waiting, blocked) and a readiness badge (ready, waiting, blocked) whose tooltip names the unmet predecessors; a blocked row has a red border. A task with predecessors among the waiting tasks is indented by the depth of its chain (up to three levels). Hovering or focusing a row highlights it, everything it waits for, everything that waits for it and the cards of the runs among them; the highlight is off while a row is dragged. "Run now" on a task that is not ready asks to confirm "Dependencies are not met" and lists them, and removing a task that others wait for names them and says they will stop waiting for it. Dependencies never limit the order of the list.
- Statuses are shown as text labels with an icon ("Needs answer", "Running", "Merged", "Delivery failed"). The status code (`needs_human`, `apply_failed`) is visible in the tooltip on hover and focus and is part of the badge's accessible name. An unknown code is shown as is.
- The run header has the main "Deliver" button, a "More" menu ("Deliver with --force…" with the refusal reason and the list of files, "Copy run id"), "Cancel run" and "Retry failed". Cancelling a run or a group, removing from the queue, leaving an unsaved form and rereading the configuration ask for confirmation in a dialog: focus is on the refusal, and `Esc` refuses. The results of actions are shown as notifications; errors stay until they are dismissed.
- A group opens as a screen with a pinned header (step, round, time, changes, delivery, "Retry", "Cancel group"). The question to a human (typed text is not lost on updates; a plain question is rendered as markdown), warnings, files outside the worktree and the permission hint are above the tabs. The "Log", "Changes" and "Task" tabs are not reset by live updates. "Log" shows the attempts on a timeline: each has the specialist, the runtime, the verdict, the tokens and the cost. The last one is open, and the others expand on a click (a button with `aria-expanded`). Inside is the transcript: the specialist's text is markdown, tool calls and results are collapsed, tool errors are highlighted, and at the end are the summary and the remarks. HTML from the log is shown as text. The log of a running attempt keeps loading by itself. The "raw log" switch shows the lines as they are, and "only specialist replies" hides everything else in all logs. "Changes" is a file tree with `+N −M` and totals per directory.
- If a specialist asked structured questions (`questions` in `swarm_report`), the "Specialist questions · N" form is above the tabs. Each question has a "Question N of M" heading, its text in markdown, and options as buttons (a pressed one is marked `aria-pressed`, the recommended one with a "recommended" badge). A question without options has a "Recommendation: …" line. There is also an "answer to question N" field, already filled with the recommendation. Choosing an option puts its text in the field. While a field is empty, "Answer" is unavailable and an "Unanswered: K" counter is visible. Drafts are stored per group and question text: they survive live updates, switching tabs and moving to another group, are cleared after sending, and new questions are filled with recommendations again. The specialist gets `Q1: …` / `A1: …` for each question; if sending fails, the fields stay as they are.
- The command palette (`Cmd+K` on macOS, `Ctrl+K` elsewhere) searches sections, runs (those waiting for an answer first), groups of the open run, workflows and specialists, and runs actions ("New task in the queue"). Keys outside input fields and open dialogs: `j` and `k` for the next and previous run, `?` for the shortcut help.
- The "Topology" tab shows all workflows of the selected repository's configuration: a list on the left with the number of active runs, and the graph of the selected one on the right. The graph goes left to right: the split (if there is one), the steps with their specialist, runtime, model and permissions, the merge, the delivery and the resolver. Nodes are centered, and each step has an "attempts N" line (0 until the step has run). Live updates do not flicker or reset the zoom, which is fitted when the tab opens and when another workflow is selected. Dashed arcs are `on_reject` returns with their round limit. On top of the graph are the groups of all active runs of this workflow, each at its current step, and the node with a working group is highlighted. Under the lines of a node whose specialist has a limit or is working is "busy N of M · in other runs: K": N counts the attempts of that specialist across the whole machine (all repositories, global and project specialists with the same slug, other workflows), K those of them in runs the graph does not show, and M is the smallest `max` seen. A node whose specialist has reached its limit is highlighted, because a group will wait for it. A click on a node shows its groups with the run titles; if the specialist of the node is busy or awaited in other runs, the side panel also lists those groups (step, run title, repository) under "Specialist busy in other runs", and a click on one opens it. A click on a group opens it in "Runs" on the "Log" tab with the last attempt of that step. If the configuration does not pass validation, the tab shows the errors with their files. The addresses `#runs/<run-id>/<group>` and `#topology/<workflow>` open the right place.

- The "Specialists" tab edits the project's `aip/specialists/<slug>.yaml` files for the selected repository and the shared `$XDG_CONFIG_HOME/aip/specialists/<slug>.yaml` files. On the left is the list of specialists of the resulting configuration, with a level badge ("project", "global", "project over global"), a "General settings" item (read only: the `settings.yaml` values with the file of each field) and a "New specialist" button. Configuration validation errors are above the list, with the file and the field path. The form has `name`, `model`, `runtime`, `permissions`, `timeout`, `allow_commands`, `tools`, `skills`, `max` and `prompt`. Lists are entered one value per line. An empty field removes the key from the file, and the specialist inherits the value from `defaults` again (it is shown as a hint). Before writing, the daemon assembles the resulting configuration with the changed file in memory. An edit is rejected only if it introduces a new error, so a configuration with errors can be repaired one file at a time. Comments and key order in the file are preserved, and only the changed fields are rewritten. If the file was changed on disk after the form was opened, saving is rejected as a conflict, and the panel offers to reread the specialist. "Save as…" creates a copy under a new slug. "Delete" removes the file (if steps, `split`, `delivery.resolver` or `delivery.message_specialist` refer to the specialist, deletion is rejected with a list of references). "Override in the project" copies a shared specialist into the project, "Make global" copies a project one into the shared directory, and "Remove the override" deletes the project file so the shared one applies again. If files exist on both levels (and for a new specialist), the form shows a "Project / Global" switch: saving, "Save as…" and deleting work on the chosen level, and switching with unsaved edits asks for confirmation. The form warns that a shared file applies in all repositories. A shared file is validated like a project one (revision, comment preservation, atomic write) and also on its own: a shared workflow cannot refer to a specialist that exists only in projects. Deleting a shared specialist is rejected if the shared level refers to it. Other repositories are not checked when you edit the shared level; their errors are visible in `aip config check`. The shared `settings.yaml` cannot be edited from the panel. Changes apply to new runs; running runs keep working from their snapshot, and their permissions are refreshed on a retry or an answer. The addresses are `#specialists`, `#specialists/<slug>` and `#specialists/new`.
- Under every section there is a collapsible "Specialist load" strip with the current load of specialists across all repositories. Collapsed, it shows "running N · waiting M" (or "All specialists are free"). Expanded, it has two blocks: "Global" (specialists defined only in the global `aip/` directory, with the repositories that use them) and "Project" (by repository, the selected one first). Each specialist shows the limit (`of N`), the groups that run on it and those waiting for it, with the step and the run title; a click on a group opens it in "Runs" and selects its repository. The strip updates with every run event, and whether it is open is remembered in the browser. A project specialist that overrides a global one counts as a project specialist.
- The "Workflow" tab edits the project's `aip/workflows/<id>.yaml` files by the same rules as specialists: validation of the resulting configuration before writing, the file revision, comment preservation, the "Project / Global" level choice (shared files live in `$XDG_CONFIG_HOME/aip/workflows/`), "Override in the project" and "Make global". The preview of a shared workflow is built from the shared level. The form keeps the steps as a list: id, a specialist from a list, the return on rejection (the list has earlier steps only) with the number of rounds, and the step's additional prompt. Steps are added, deleted and reordered with the "up" and "down" icon buttons, and renaming a step updates the returns that referred to it. The split block is turned on with the "Task split" switch. The form is divided into the "Form" tab (open by default) and the "Preview" tab; the header and the save buttons stay under both. On "Preview" the graph takes the whole width of the area and almost the whole height of the window: it is the same graph as on "Topology", but without run groups. The daemon builds it from the draft without writing 300 ms after the last edit. While the draft does not pass validation, the last valid graph stays with a "stale" mark (also shown on the "Preview" tab label), and the errors are shown at the steps and fields on the "Form" tab. "Save as…" creates a copy. "Delete", after a confirmation that names the number of running runs, removes the file: running runs continue from their snapshot, and a new run of the deleted workflow is rejected. The "Edit" link in the graph header on "Topology" opens this workflow in the editor. The addresses are `#workflows`, `#workflows/<id>` and `#workflows/new`.
- If a group failed (`failed`) or was cancelled (`cancelled`), the header of its last attempt has a "Retry step" button, which does the same as `aip group retry <run-id> <group>`. If a run has several failed groups, the "Retry failed (N)" button (or "Retry failed and cancelled (N)" if some are cancelled) in the run header retries them all and reports which ones could not be retried.
- A finished run (`finished` or `failed`) with group warnings has a yellow "Warnings: N" badge (the sum over the groups) next to the state badge. Warnings do not affect the run's state.
- Theme: "System", "Light" or "Dark" (a menu in the strip; the choice is remembered). The connection indicator shows "Connected", "Reconnecting" or "Polling" (the codes `live`, `reconnecting` and `polling` are in the tooltip). The notifications button turns on browser notifications for `needs_human` and `failed`.
- The panel is built on Radix, Tailwind CSS v4 and the Inter font, which `aip web` serves itself. A modern browser is required: Chrome 111+, Safari 16.4+, Firefox 128+.
- The panel listens on the local address only (`--host` accepts `127.0.0.1`, `localhost` or `::1`, and anything else is rejected), checks the `Host` and `Origin` headers and accepts changes only as `application/json`. New runs are not started from the browser: use `aip run`.

The panel is a React application in the `web/` directory. `npm run build` builds it into `dist/web`, from where `aip web` serves it. Without a build, the page tells you to run `npm run build`. For development, run `aip web` and, in another terminal, the Vite dev server with a proxy to it, passing the token from the printed link:

```
AIP_WEB_URL=http://127.0.0.1:7341 AIP_WEB_TOKEN=<token> npx vite --config web/vite.config.ts
```

## Multiple repositories

One daemon and one state database (`$XDG_STATE_HOME/aip/`, `~/.local/state/aip/` by default) serve all repositories. The daemon, the run database and the shared configuration level (`$XDG_CONFIG_HOME/aip/`) are common to all of them. Each repository has its own project configuration (`aip/`), queue and working files in `.aip/`.

- **The list of repositories.** The daemon keeps a list of repositories in its database. The list fills itself: a repository joins it on the first request that touches it (`aip run`, `aip queue …`, the "Queue", "Topology", "Specialists" and "Workflow" sections of the panel), and manually through `aip repo add`. Runs and queues created before the list existed join it on upgrade. `aip config check` works without the daemon and does not change the list. For every repository, `aip repo list` shows the number of unfinished runs, runs waiting for an answer, and queued tasks. `aip repo remove <path>` removes the entry (runs and the queue are not deleted) and refuses while there are unfinished runs or queued tasks. A removed repository returns to the list on the next request that names it: the list is whatever you work with.
- **CLI.** `--repo <path>` exists on `aip run start`, `aip queue …` and `aip config check`; by default it is the current directory. Commands that take a run id (`aip run list`, `aip run watch`, `aip group`, `aip run cancel`, `aip group retry`, `aip group answer`, `aip run apply`) work from any directory. `aip run list` shows the runs of all repositories.
- **MCP and the plugin.** `swarm_run` and `swarm_queue*` (for example, `swarm_queue_add`) have `repo?`; without it the repository of the current directory is used. `/aip:run` starts a workflow in the repository of the Claude Code session, and `/aip:web` starts `aip web`. The session's directory does not affect which repository the panel selects.
- **Limits.** The global limit of working specialists is one per daemon, equal to `swarm.max` of the most recently started run. A specialist's `max` is counted by its slug across all runs, including those in other repositories, so a specialist in a second repository may wait for one in the first to finish.
- **Web panel.** "Queue", "Topology", "Specialists" and "Workflow" belong to the repository selected in the strip (at first, the most recently added to the daemon's list). "Runs" shows the runs of the selected repository or of all. A second `aip web --port 7342` for another repository is not needed; it remains for a separate panel with its own token. If the port is busy, `aip web` fails with `port <host>:<port> is already in use, maybe by another aip web: …`. The panel may already be running: pick the repository in it, or give `--port`.

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

