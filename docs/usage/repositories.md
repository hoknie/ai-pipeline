# Multiple repositories

One [daemon](daemon.md) and one state database serve all your repositories. The shared configuration is common too. Each repository has its own project configuration (`aip/`), [queue](queue.md), [tag catalog](tags.md) and working files in `.aip/`.

```sh
cd ~/projects/app && aip run start feature --task "..."
cd ~/projects/site && aip run start feature --task "..."
aip queue add feature --task "..." --repo ~/projects/site   # the queue of another repository
aip queue start --repo ~/projects/site
aip run list                        # runs of both repositories
aip repo list                       # the daemon's repositories with counters
aip repo add ~/projects/new         # add a repository before its first run
aip repo remove ~/projects/old      # remove from the list
```

## The list of repositories

The daemon keeps the list in its database. A repository joins on the first request that touches it (`aip run`, `aip queue …`, the "Queue", "Topology", "Specialists" and "Pipeline" sections of the panel), or through `aip repo add`. `add` finds the git root from a subdirectory.

- `aip repo list` shows the unfinished runs, runs waiting for an answer and queued tasks of each repository.
- `aip repo remove <path>` removes the entry and keeps runs and the queue. It refuses while there are unfinished runs or queued tasks. A removed repository returns on the next request that names it.
- `aip config check` works without the daemon and does not change the list.

## Choosing a repository

- **CLI.** `--repo <path>` exists on `aip run start`, `aip queue …`, `aip tag …` and `aip config check`. By default it is the current directory. Commands that take a run id work from any directory, and `aip run list` shows the runs of all repositories.
- **MCP and the plugin.** `swarm_run` and `swarm_queue*` have `repo?`. `/aip:run` starts a pipeline in the repository of the Claude Code session. The session's directory does not affect which repository the Claude Code panel selects.
- **Web panel.** One panel serves all repositories: [pick the repository](../web/README.md#repositories) in it. `aip web --port 7342`, run from a repository, is only for a separate panel with its own token.

## Limits

[`max`](../configuration/README.md#max) is counted per repository: each repository gets the `max` of its most recently created run, and its runs do not wait for slots taken in another repository. A [specialist's `max`](../configuration/specialists.md#limits) is counted by its slug across all runs, so a specialist in a second repository may wait for one in the first.
