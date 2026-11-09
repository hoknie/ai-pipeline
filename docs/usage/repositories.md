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
aip repo edit new --name "New shop" # name, slug, color, enable or disable a project
aip queue list --repo new           # a project slug works instead of the path
aip repo move new ~/work/new        # the repository moved: give the project its new path
aip repo remove ~/projects/old      # remove from the list
```

## The list of repositories

The daemon keeps the list in its database. A repository joins on the first request that touches it (`aip run`, `aip queue …`, the "Queue", "Topology", "Specialists" and "Pipeline" sections of the panel), or through `aip repo add`. `add` finds the git root from a subdirectory.
A project of the list is addressed by its path even when its directory is gone (for example after the state moved to another machine), so it can still be moved or removed.

- `aip repo list` shows the slug, name and state (`on` or `off`) of each project, with its unfinished runs, runs waiting for an answer and queued tasks.
- `aip repo remove <project>` removes the entry and keeps runs and the queue. It refuses while there are unfinished runs or queued tasks; a queue left running without tasks does not hold it. A removed repository returns on the next request that names it.
- `aip config check` works without the daemon and does not change the list.

## Projects

Each repository of the list is a project with a few attributes of its own. They live in the daemon's database, not in the repository, and you change them with `aip repo edit`, `aip repo add` or in the "Projects" group of the panel's [settings](../web/settings.md).

- **Name.** Shown in the panel instead of the directory name. `--no-name` drops it.
- **Slug.** A short address: lower-case letters, digits and dashes, up to 40 characters, unique among the projects. A new project gets one from its directory name (`My Shop.API` becomes `my-shop-api`, and a taken slug gets `-2`, `-3`, …). Change it with `--slug`; the old slug stops working at once.
- **Color.** One of `gray`, `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `violet`, `pink`, `brown`, shown as a dot next to the name. `--color none` drops it.
- **Enabled.** A disabled project is hidden in the pickers of the panel and takes no new work: new runs, new tasks of its queue (also from specialists), the start of its queue and retries are refused with ``project `<slug>` is disabled``.
  - Disabling pauses its queue. Running runs go on, and you can still answer, pause, cancel and deliver them.
  - Enabling does not start the queue.

`aip repo move <project> <path>` gives a project a new path after its repository moved. Its runs, queue with its tasks, tags and observer settings follow, and the name, slug and color stay. The path may start with `~/`.
It refuses while the project has unfinished runs, or when the new path is already in the list. No files are moved: worktrees of finished runs at the old place are left for `aip clean`.

## Choosing a repository

- **CLI.** `--repo <path>` exists on `aip run start`, `aip queue …`, `aip tag …` and `aip config check`. By default it is the current directory. Commands that take a run id work from any directory, and `aip run list` shows the runs of all repositories.
  - Instead of the path, `--repo` takes a project slug; when the current directory has a file or directory of that name, the path wins. `aip config check` works without the daemon and takes only a path.
- **MCP and the plugin.** `swarm_run` and `swarm_queue*` have `repo?`, a path or a project slug. `/aip:run` starts a pipeline in the repository of the Claude Code session. The session's directory does not affect which repository the Claude Code panel selects.
- **Web panel.** One panel serves all repositories: [pick the repository](../web/README.md#repositories) in it. `aip web --port 7342`, run from a repository, is only for a separate panel with its own token.

## Limits

[`max`](../configuration/README.md#max) is counted per repository: each repository gets the `max` of its most recently created run, and its runs do not wait for slots taken in another repository. A [specialist's `max`](../configuration/specialists.md#limits) is counted by its slug across all runs, so a specialist in a second repository may wait for one in the first.
