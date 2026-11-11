# Web panel

The web panel is a page in your browser. In it you follow runs, answer specialists, manage the queue and edit specialists, pipelines (pipelines) and settings. The daemon serves it, so it is there whenever the daemon runs.

| Section | What it does | Read more |
|---|---|---|
| "Runs" | Follow, answer, retry and deliver runs | [web/runs.md](runs.md) |
| "Queue" | Add, order and run tasks | [web/queue.md](queue.md) |
| "Specialists" | Edit specialist files | [web/config.md](config.md#specialists) |
| "Pipeline" | Edit pipeline files; the "Topology" tab shows the graph of a pipeline with live groups | [web/config.md](config.md#pipeline) |
| "Statistics" | Tokens, cost and time by day, project, specialist and model | [web/stats.md](stats.md) |
| "Settings" | Edit `settings.yaml`, shared specialists and pipelines; the system state | [web/settings.md](settings.md) |

The counter on "Runs" shows unfinished runs, and on "Queue" the queued tasks. The panel talks to the daemon through its [HTTP API](http-api.md).

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
- The token, `auth` and the address are set in the [`web` section](../configuration/README.md#web).

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

The panel can outlive a stopped daemon: see [The panel and the daemon](../usage/daemon.md#the-panel-and-the-daemon). In Claude Code, [`/aip:web`](../hosts/claude-code.md#aipweb) gives the link.

## Security

- The panel listens on the local address only. `--host` accepts `127.0.0.1`, `localhost` or `::1`.
- With `web.auth: token` (the default) a request without the token gets 401. See [`web`](../configuration/README.md#web) for `auth: none`.

## Repositories

The repository picker lists the enabled [projects of the daemon](../usage/repositories.md#projects) by name, with the color of each project. "Manage projects" opens the group ["Projects"](settings.md#projects) of the settings.

- "Add repository…" takes a path inside a git repository, absolute or from the home directory (`~/…`), adds its root and selects it. "Browse…" next to the field opens a folder browser of the machine the panel runs on; git roots are marked.
- The picker does not remove repositories: remove one in the group ["Projects"](settings.md#projects) of the settings or with `aip repo remove`.
- The choice is remembered in the browser. "Queue", "Specialists", "Pipeline" and the command palette work with the selected repository.
- Other repositories with runs waiting for an answer get a counter in the list.

## Status

Under every section is a collapsible "Status" strip with the current load across all repositories. Whether it is open, its height and the selected tab are remembered in the browser.

- Collapsed, it shows "Status: specialists — running N · waiting M | background processes — running K". Before the first answer about processes, or when it fails, K is "—".
- On the right of the strip is the connection indicator: "Connected", "Reconnecting" or "Polling".

### Specialists tab

- "Global" lists specialists defined only in the shared directory, with the repositories that use them. "Project" lists them by repository, the selected one first. A project specialist that overrides a shared one counts as a project specialist.
- Each specialist shows its limit (`of N`) and the groups running on it or waiting for it, with the step and the run title. A click on a group opens it in "Runs".

### Background processes tab

The tab lists what the agents of the daemon started: their child processes and the members of their process groups, including those left after the agent exited, while they live. The agent itself and its `aip mcp --worker` server are not listed, nor are processes that left the process tree and group of the agent (`setsid`, a double fork).

- A row has the PID, the command with its arguments, the uptime, the average CPU (CPU time over uptime, percent of one core) and the memory (resident set).
- "Terminate" asks for confirmation, then sends `SIGTERM` to the process and its children and, after 5 seconds, `SIGKILL` to those still alive. The group keeps running. The daemon ends only processes from its own list; any other PID is refused.

## Keyboard and look

- `Cmd+K` on macOS, `Ctrl+K` elsewhere, opens the command palette. It searches sections, runs (those waiting for an answer first), groups of the open run, pipelines and specialists, and runs actions such as "New task in the queue".
- Outside input fields and dialogs: `j` and `k` move to the next and previous run, `?` shows the shortcuts.
- Cancelling a run or a group, removing from the queue, leaving an unsaved form and rereading the configuration ask for confirmation. Focus is on the refusal, and `Esc` refuses.
- Results of actions are notifications. Errors stay until you dismiss them.
- Themes are "System", "Light" and "Dark". The choice is remembered.
- The notifications button turns on browser notifications for `needs_human` and `failed`.
- The interface is in English, Spanish, Russian and Chinese. The browser language chooses it, and the "Language" menu changes it.
- The panel needs a current browser: Chrome 111, Safari 16.4 or Firefox 128 and newer.
