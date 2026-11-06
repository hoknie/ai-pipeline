# Daemon

The daemon owns all state and runs the agents. It starts automatically on the first request of any `aip` command, of `aip mcp` or of the panel, so you rarely touch it. One daemon serves all [repositories](repositories.md) of a user.

## Controlling the daemon

```sh
aip daemon start          # does nothing if it runs
aip daemon stop [--force] [--web]
aip daemon restart [--force] [--web]
aip daemon status [--json]
```

- `stop` and `restart` refuse with code 1 while agents work or a merge runs. `--force` stops the daemon together with its agents, and their steps become `failed` with the reason `interrupted` at the next start.
- `status` starts and stops nothing. It exits with code 3 when no daemon runs.
- Bare `aip daemon` runs the daemon in the foreground.

### The panel and the daemon

The daemon serves the [web panel](../web/README.md), so stopping it needs a decision about the panel.

- `restart --web` also raises the panel of the new daemon, even with `web.autostart: false`, and prints `aip web: <url>`. If the panel cannot start (a busy port, an error in the `web` section), the reason goes to stderr, the exit code is 1 and the daemon keeps running.
- `stop --web` stops the daemon and keeps serving the panel in this process, at its address and with its token. This stand-in never starts the daemon by itself.
- Once a daemon runs again ("Start daemon" in the panel, `aip daemon start` or any other `aip` command), the stand-in hands the panel back to it with the token and exits. `aip web stop` stops the stand-in.

## Replacing an old build

The daemon and its clients (the CLI, `aip mcp`, `aip web`) compare builds. A build is the version of `aip` together with its code, so a rebuild without a version bump is a different build.

- If the daemon is older than the client and nothing is working or merging, the client stops it and starts a daemon of its own build. Runs, queues and answers are kept in the database.
- If agents are working, the daemon keeps going and the client writes a warning to stderr. The next `aip` command after the agents finish restarts the daemon. To replace it at once, run `aip daemon restart --force`, which stops running agents.
- `aip web` checks the daemon every 30 seconds and shows the warning as a banner above the page.
- If the daemon is newer than the client, the daemon is left alone and the client asks you to restart itself.

## Where files live

| Path | What it holds |
|---|---|
| `~/.config/aip/` (or `$XDG_CONFIG_HOME/aip/`) | The [shared configuration](../configuration/README.md#where-the-configuration-lives): `settings.yaml`, `specialists/`, `workflows/` |
| `aip/` in a repository | The project configuration, which takes precedence |
| `<repository>/.aip/` | The group worktrees and step logs. The directory is added to `.git/info/exclude`; set another location with `workspace_dir` |
| `~/.local/state/aip/` (or `$XDG_STATE_HOME/aip/`) | The state directory: the database, the socket, the daemon log, `web.json`, `artifacts/`, `patches/` |
