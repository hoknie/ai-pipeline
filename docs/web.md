# Web panel

The web panel is a page in your browser. In it you follow runs, answer specialists, manage the queue and edit specialists and workflows. For the commands see [cli.md](cli.md), for the settings see [configuration.md](configuration.md).

## Open the panel

The daemon starts the panel on `127.0.0.1:7341` and keeps it while it runs. The daemon starts on any `aip` command.

```
aip web [--port <n>] [--host <addr>] [--open]   # defaults: web.port and web.host: 7341, 127.0.0.1
```

- `aip web` prints the link of the daemon's panel and exits with code 0:

  ```
  aip web: http://127.0.0.1:7341/?token=…
  aip web: served by the aip daemon (pid N)
  ```

- With `web.autostart: false` or `AIP_WEB_AUTOSTART=0`, `aip web` runs its own server until Ctrl+C, with a new random token on every start. `aip web --port <n>` on another port also starts its own server.
- If the port is busy, `aip web` fails with `port <host>:<port> is already in use, maybe by another aip web: …`. The panel may already be running: open it, or give another `--port`.
- The token, `auth` and the address are set in the [`web` section](configuration.md#web).

## Control the panel

```
aip web start [--open]      # start the daemon if needed and raise the panel, even with autostart: false
aip web stop                # stop the panel only; the daemon and its agents keep running
aip web restart [--open]    # stop and raise again, re-reading the web section; the token is kept
aip web status [--json]     # running (pid N), url, address, auth; exit code 3 when it does not run
```

- The pid is the daemon's pid. The panel has no process of its own.
- If the port is busy or the `web` section has an error, the command exits with code 1 and the daemon keeps working. `status` then shows the `reason`.
- A panel stopped by `aip web stop` stays stopped until `aip web start`, `aip web restart` or the next start of the daemon.
- `status` and `stop` never start the daemon.

## Security

- The panel listens on the local address only. `--host` accepts `127.0.0.1`, `localhost` or `::1`.
- With `web.auth: token` (the default) a request without the token gets 401. See [`web`](configuration.md#web) for `auth: none`.
- New runs are not started from the browser. Use `aip run`.

## Repositories

The repository picker lists the repositories of the daemon (see [Multiple repositories](hosts.md#multiple-repositories)).

- "Add repository…" takes a path inside a git repository, adds its root and selects it.
- "Remove from list" is in every item except the default repository, the most recently added one. The daemon refuses to remove a repository with unfinished runs or queued tasks.
- The choice is remembered in the browser. "Queue", "Topology", "Specialists", "Workflow" and the command palette work with the selected repository.
- Other repositories with runs waiting for an answer get a counter in the list.

## Sections

The sections are "Runs", "Queue", "Topology", "Specialists", "Workflow" and "Settings". The counter on "Runs" shows unfinished runs, and on "Queue" the queued tasks. Runs waiting for an answer come first in the list, then the other unfinished runs, then finished ones.

### Runs

- Filters: repository, a search and the status ("All", "Waiting", "Active", "Finished").
- A run card shows the first line of the task, the status, workflow, time, cost and a summary of changes (`2 files +367 −0`).
- The run header has "Deliver", "Cancel run", "Retry failed (N)" and "Retry with current config (N)". The "More" menu has "Deliver with --force…" and "Copy run id".
- "Retry with current config" is in the header for every failed or cancelled group, and next to "Retry" of a failed or cancelled group or split step. It retries as `aip group retry --refresh-config`: the run first takes the specialists (model, runtime, prompt, permissions) from the current configuration, and the workflow stays as it started.
- The retried group shows the warning `config refreshed: …` with the changes. A broken configuration refuses the retry with its error. Commit message and resolver steps do not have this button.
- The run header has a "Steps" block: each step of the workflow with its state (done, running, upcoming) and a "Skip" switch with a visible label for steps that are not finished yet.
  - Skipping a running step asks for confirmation: the specialist is stopped without a commit.
  - Its partial changes stay uncommitted in the group worktree.
  - Turning the switch off brings the step back.
  - Steps skipped when the run was created are not shown.
- A finished run with group warnings has a yellow "Warnings: N" badge.

### Group

- The header has the step, round, time, changes, delivery, "Retry step", "Skip step" and "Cancel group".
  - "Skip step" is shown for the step the group stands on, unless that step is skipped or finished. It skips the step for the whole run. The panel asks for confirmation when an attempt is running on the step or the run has more than one group.
- Above the tabs are the question to a human, warnings and files outside the worktree.
- "Log" shows the attempts of the group: specialist, runtime, verdict, tokens and cost. The log of a running attempt keeps loading by itself.
- "Changes" is a file tree with `+N −M`. "Task" shows the task text.
- The addresses `#runs/<run-id>` and `#runs/<run-id>/<group>` open a run and a group.

### Questions

A specialist can ask structured questions (`questions` in `swarm_report`). They appear as the "Specialist questions · N" form above the tabs.

- A question shows its options as buttons. The recommended option has a "recommended" badge.
- The answer field is filled with the recommendation. "Answer" is unavailable while a field is empty.
- Drafts are kept until the answer is sent.

### Queue

The queue settings are in [queue.md](queue.md).

- The "Queue controls" block on the left holds the state, the buttons "New task", "Start" and "Pause", the parallelism and the link "Queue settings".
- The modes of the queue are in the group "Queue" of [Settings](#settings) (`#settings/queue`): the switches "Autopilot", "Skip failed" and "Auto delivery", the "Delivery mode" selector, the autopilot's answer text and the "On a usage limit" selector.
  - "Auto delivery" and "Delivery mode" write `delivery.auto` and `delivery.mode` to the file the value comes from: the project `aip/settings.yaml` if the field is set there, otherwise the shared `settings.yaml`. The file is shown under the control. The group "Delivery" writes to the same file.
- The "On a usage limit" selector chooses `wait` or `stop`. A queue stopped by a usage limit shows which agent ran out, when the limit resets and, with `wait`, when the queue resumes by itself. "Pause" cancels the automatic start. A group waiting for the reset shows "Limit until HH:MM".
- "Return to the queue" is on a skipped run only when it has failed or cancelled groups to retry. It is also in the header of any run with failed or cancelled groups that is not in its queue. The run becomes the first task, marked "Return" with a link to the run. Only its place and predecessors can be changed.
- "Remove from list" is on every skipped run in the block "Skipped with a problem". After a confirmation the card disappears; the run itself does not change.
- The "In work" switch of a row postpones the task or puts it back.
- A running run's card shows its duration, tokens and cost.
- "New task" opens a dialog with two halves: the task (title, workflow, text or groups) on the left and the settings (predecessors, tags, delivery, "Skip steps") on the right. "Skip steps" is a row of segments: a pressed segment is a skipped step, and the last unpressed one stays disabled. Below the controls are the running runs and the waiting tasks.
- Runs the queue skipped because of a problem are in the "Skipped with a problem" block. They do not count as taken places.
- Drag a task by its handle to reorder it, or use `Alt+↑` / `Alt+↓`. Every waiting task has "Edit", "Delete" and "Run now".
- The "Waits for" field of the task form chooses the predecessors. A row shows the state of each predecessor and a readiness badge (ready, waiting, blocked).
- "Run now" on a task that is not ready asks to confirm "Dependencies are not met" and lists them.

### Topology

- The list shows the workflows of the repository with the number of active runs. The graph shows the steps with specialist, runtime, model and permissions, the split, the merge, the delivery and the resolver.
- Dashed arcs are `on_reject` returns with their round limit.
- The groups of active runs sit at their current step. A click on a group opens it in "Runs".
- A node whose specialist has a limit shows "busy N of M · in other runs: K". It is highlighted when the limit is reached.
- A step node shows "attempts N" and, on a line of its own, the tokens and cost of the active runs: `in/out · $cost`. Until a cost is known only tokens are shown, and "—" when there is no usage.
- The address `#topology/<workflow>` opens a workflow.

### Specialists

The tab edits the `aip/specialists/<slug>.yaml` files of the project and of the shared directory. The shared `settings.yaml` is read-only.

- The list shows each specialist with a level badge ("project", "global", "project over global"). "New specialist" creates one.
- The form has the fields described in [configuration.md](configuration.md#specialists). An empty field removes the key from the file.
- Before writing, the daemon checks the resulting configuration. An edit is rejected only if it adds a new error, so a broken configuration can be repaired one file at a time.
- Comments and key order are kept. If the file changed on disk, saving is rejected and the panel offers to reread it.
- "Save as…" copies a specialist, "Delete" removes it. Delete is refused with a list of references while steps use the specialist.
- "Override in the project", "Make global" and "Remove the override" move a specialist between the levels. A "Project / Global" switch chooses the level when files exist on both.
- Changes apply to new runs. Running runs keep their snapshot.
- The addresses are `#specialists`, `#specialists/<slug>` and `#specialists/new`.

### Workflow

The tab edits the `aip/workflows/<id>.yaml` files of the project and of the shared directory, with the save, delete and level rules of specialists.

- The form lists the steps: id, specialist, the return on rejection with the number of rounds, and the additional prompt. Steps are added, deleted and reordered with buttons.
- The "Task split" switch turns on the split block.
- "Preview" shows the graph of the draft without writing. While the draft is invalid, the last valid graph stays with a "stale" mark.
- Running runs continue from their snapshot after the workflow is deleted. A new run of a deleted workflow is rejected.
- The addresses are `#workflows`, `#workflows/<id>` and `#workflows/new`.

### Settings

The section shows the settings of the selected repository in groups. The groups are listed on the left, in this order: "General", "Defaults", "Delivery", "Working copy", "Naming", "Claude", "Runtimes", "Web panel", "Queue", "Tags" and "System".

The address is `#settings/<group>`; an unknown group opens "General", and the address `#specialists/_settings` of earlier versions opens `#settings/general`.

- The groups from "General" to "Web panel" are the sections of `settings.yaml`, shown as a result of the shared and the project levels, with the file each value comes from. Only "Auto delivery" and "Delivery mode" (group "Delivery") can be changed here; the others are edited in the files.
- `web.*` and `runtimes.*` are read from the shared `settings.yaml` only. Of the runtime environment only the names of the variables are shown, never their values. A change takes effect after the restart: see "System".
- A group with configuration errors gets a mark; the errors are shown in the group. Errors of specialists and workflows are shown in "General".
- "Queue" holds the modes of the queue (see [Queue](#queue)), "Tags" the tag catalog shared by all repositories.
- "System" shows the state of the daemon (pid, version, build, whether agents work) and of the web panel (pid, address without the token, access, build), refreshed every 3 seconds, and the path of the daemon log.
  - "Restart panel" restarts the panel on the same address with the same token; the page comes back by itself. The daemon and its agents keep running.
  - "Restart daemon" runs `aip daemon restart --web` as a separate process. While agents work the panel asks again, and "Restart, stopping the agents" runs it with `--force`.
  - A panel started by `aip web` itself cannot restart itself or the daemon: restart it in the terminal.
  - The page waits up to 30 seconds for the restarted part to answer (for the daemon, with a new pid) and otherwise points to the daemon log.

## Status

Under every section is a collapsible "Status" strip with the current load across all repositories. Whether it is open and which tab is selected are remembered in the browser. The specialists update with every run event, the background processes every 3 seconds while the page is visible.

- Collapsed, it shows "Status: specialists — running N · waiting M | background processes — running K". Zeros are shown. Before the first answer about processes, or when it fails, K is "—".
- On the right of the strip is the connection indicator: "Connected", "Reconnecting" or "Polling". A click on it does not open the strip.
- Expanded, it has two tabs: "Specialists" and "Background processes".
- "Specialists" has "Global" (specialists defined only in the global `aip/` directory, with the repositories that use them) and "Project" (by repository, the selected one first).
- Each specialist shows its limit (`of N`) and the groups running on it or waiting for it, with the step and the run title. A click on a group opens it in "Runs".
- A project specialist that overrides a global one counts as a project specialist.
- "Background processes" lists what the agents of the daemon started: their child processes and the members of their process groups, including those left after the agent exited, while they live.
- The open strip has a constant height, the same on both tabs: 256 px by default. Drag its top edge, or press the up and down arrows on it (16 px a step), to change it, from 160 px to 80 % of the window height. The height is remembered in the browser; when the window gets smaller the strip shrinks and returns to the chosen height when the window grows.
- The agent itself and its `aip mcp --worker` server are not listed.
- A row has the PID, the command with its arguments (a long one is cut with an ellipsis, the full line is in the tooltip, and a button copies it), the owner group (a link to it), the uptime, the average CPU (CPU time over uptime, percent of one core) and the memory (resident set).
- "Terminate" is an icon button with a tooltip. It asks for confirmation, then sends `SIGTERM` to the process and its children and, after 5 seconds, `SIGKILL` to those still alive. The group keeps running. The daemon ends only processes from its own list; any other PID is refused.
- Processes that left the process tree and group of the agent (`setsid`, a double fork) are not listed.

## Keyboard and look

- `Cmd+K` on macOS, `Ctrl+K` elsewhere, opens the command palette. It searches sections, runs (those waiting for an answer first), groups of the open run, workflows and specialists, and runs actions such as "New task in the queue".
- Outside input fields and dialogs: `j` and `k` move to the next and previous run, `?` shows the shortcuts.
- Cancelling a run or a group, removing from the queue, leaving an unsaved form and rereading the configuration ask for confirmation. Focus is on the refusal, and `Esc` refuses.
- Results of actions are notifications. Errors stay until you dismiss them.
- Themes are "System", "Light" and "Dark". The choice is remembered.
- The notifications button turns on browser notifications for `needs_human` and `failed`.
- The interface is in English, Spanish, Russian and Chinese. The browser language chooses it, and the "Language" menu changes it.
- The panel needs a current browser: Chrome 111, Safari 16.4 or Firefox 128 and newer.

## HTTP API

- `POST /api/runs/<id>/skip` with the body `{"step": "<step id>", "skip": true}` skips a step of the run (`false` brings it back) and returns the run. A refusal of the daemon (unknown step, a step every group has passed) comes back with code 400.
- `POST /api/queue/dismiss` with the body `{"run": "<run id>"}` removes a skipped run from the skipped list and returns the queue. A run that is not skipped comes back with code 400, an unknown run with code 404.
- `GET /api/processes` returns the background processes of the agents (`{"processes": [...]}`). `POST /api/processes/<pid>/kill` terminates one; a PID that is not a number comes back with code 400, a PID that is not in the list with code 404.
- `GET /api/repositories` returns the repositories with counters.
- `POST /api/repositories` with the body `{"path": "<absolute path>"}` adds one.
- `DELETE /api/repositories?repository=<absolute path>` removes one.
- A relative path is rejected with code 400 without contacting the daemon. Daemon errors also come back with code 400 and the error text.
- The list and its changes also arrive in `/api/events` (the `repositories` event).
- The queue requests, `/api/config…` and `/api/workflows` accept `repository=<absolute path>`.
- Without it the most recently added repository is used. While the list is empty, the answer is 409.
- A relative path and a path outside a git repository are rejected with code 400. A `repository` field in the request body is ignored.
- `POST /api/queue/settings` takes `parallel`, `autopilot`, `skipFailed`, `autopilotAnswer` and `onLimit`, all optional. An empty body is answered with 400.
- `PUT /api/config/settings/<path>` writes the general settings.
- `GET /api/system` returns the state of the daemon and of the panel (the address has no token).
- `POST /api/system/web/restart` and `POST /api/system/daemon/restart` (body `{"force": true}` optional) answer 202 `{"state": "restarting"}` and restart after the answer is sent. The answer is 409 with `code` `daemon_busy` for a busy daemon without `force`, and `web_standalone` for a panel started by `aip web`.
