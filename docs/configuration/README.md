# `aip/` configuration

The configuration is an `aip/` directory with settings, specialists and pipelines. This page covers its layout, its two levels and the fields of `settings.yaml`. The larger parts have their own pages:

- [configuration/specialists.md](specialists.md): the files in `specialists/`;
- [configuration/pipelines.md](pipelines.md): the files in `pipelines/`;
- [configuration/permissions.md](permissions.md): `claude.edit_mode` and permission levels;
- [configuration/actions.md](actions.md): the files in `actions/` and the pipeline points where they run;
- [configuration/delivery.md](delivery.md): the `delivery` section;
- [configuration/runtimes.md](runtimes.md): the `runtimes` section, `claude.mcp` and `claude.settings`;
- [configuration/network.md](network.md): the `network` section: the network check and the proxy for agents.

Every file can also be edited in the [web panel](../web/settings.md).

## Where the configuration lives

There are two levels:

- shared: `$XDG_CONFIG_HOME/aip/`, or `~/.config/aip/` if the variable is not set;
- project: `aip/` in the root of a git repository.

Inside the directory:

```
aip/
  settings.yaml          # max, delivery, workspace, defaults …
  specialists/
    coder.yaml           # the coder specialist
    reviewer.yaml        # the reviewer specialist
  pipelines/
    feature.yaml         # the feature pipeline
  actions/
    lint.yaml            # the lint action
```

`aip init` creates a starter set in the current repository, and `aip init --shared` in the shared directory.

## File rules

Every specialist and every pipeline has exactly one file.

- The specialist slug and the pipeline id are the file name without the extension (`coder.yaml` → `coder`). They must match `^[a-z][a-z0-9-]{0,31}$`.
- The file holds the body of the entry without a key for its name: `name`, `model`, `prompt` … for a specialist, `steps` and `split` for a pipeline.
- Files named `*.yaml` and `*.yml` directly in `specialists/` and `pipelines/` are read, and `settings.yaml` or `settings.yml` in `aip/`. A symlink to a file is read.
- Subdirectories, hidden files and files with other extensions are skipped.
- A pair `x.yaml` and `x.yml` is a validation error that names both files.
- Unknown keys are an error.

All files are optional, but at least one must exist on one of the levels.

## How the levels merge

The project level overrides the shared one:

| What | How it merges |
|---|---|
| `max`, `workspace_dir`, `outside_changes` | As a whole |
| `defaults`, `claude`, `delivery`, `workspace`, `naming` | Field by field |
| `web`, `runtimes`, `network` | Read from the shared level only; in a project file they are a validation error |
| Specialists, pipelines and actions | As a whole, by name: a project file `coder.yaml` replaces the shared one |
| `stages` | By point: a point of the project level replaces the shared one |

## Checking the configuration

`aip config check` works without the daemon. It prints all errors at once, each with the file and the path to the field. For a valid configuration it prints:

- the result;
- the files read in merge order (`Config files:`): on each level `settings.yaml` first, then specialists and pipelines by name, the shared level before the project level;
- the versions of the agent CLIs it found.

A run keeps a snapshot of the configuration from the moment it starts, so editing the files does not affect it. Two exceptions are [refreshed permissions](permissions.md#refreshing-permissions) and a [retry with the current configuration](../usage/runs.md#retry-with-the-current-configuration).

## `settings.yaml`

```yaml
max: 3                    # specialists running at once in the repository, 1..32
workspace_dir: .aip       # worktrees and logs: relative to the repository root, or an absolute path
outside_changes: warn     # warn | stop | off
workspace: { ... }
naming: { ... }
web: { ... }              # shared directory only
runtimes: { ... }         # shared directory only
network: { ... }          # shared directory only
claude:
  edit_mode: allowlist    # allowlist | accept_edits | auto
  mcp: isolated           # isolated | inherit
  settings: isolated      # isolated | inherit
delivery: { ... }
stages: { ... }           # actions shared by the pipelines, see actions.md
defaults: { ... }
```

| Field | Described in |
|---|---|
| `max` | [`max`](#max) |
| `workspace_dir` | [Where files live](../usage/daemon.md#where-files-live) |
| `outside_changes` | [`outside_changes`](#outside_changes) |
| `workspace` | [`workspace`](#workspace) |
| `naming` | [`naming`](#naming) |
| `web` | [`web`](#web) |
| `runtimes` | [configuration/runtimes.md](runtimes.md#runtimes) |
| `network` | [configuration/network.md](network.md) |
| `claude.edit_mode` | [configuration/permissions.md](permissions.md#claudeedit_mode) |
| `claude.mcp` | [configuration/runtimes.md](runtimes.md#claudemcp) |
| `claude.settings` | [configuration/runtimes.md](runtimes.md#claudesettings) |
| `delivery` | [configuration/delivery.md](delivery.md) |
| `stages` | [configuration/actions.md](actions.md#points) |
| `defaults` | [`defaults`](#defaults) |

### `max`

`max` limits the specialists running at once across all runs of one repository; runs of other repositories do not take its slots. The value from the configuration of the repository's most recently created run applies. A specialist can have [its own `max`](specialists.md#limits). The number of runs at once is a separate setting, [`parallel`](../usage/queue.md#running-the-queue) of the queue.

### `workspace`

```yaml
workspace:
  base: working_tree        # working_tree | head
  include:                  # paths that git ignores but specialists need
    - notes/
    - .plans/
```

- **`base`** is what a run starts from:
  - `working_tree` (the default) starts from a snapshot of your working tree: the last commit plus uncommitted edits, deletions and new files, except those git ignores. Specialists continue from where you stopped. The snapshot does not touch your branch, index or working tree;
  - `head` starts from the last commit, without uncommitted edits; the run warns you if there are any.
- **`include`** lists paths, relative to the repository root, that go into the run even though git ignores them, such as notes and plans you do not keep in history.
  - Specialists' edits to them are delivered together with the rest. In `commit` mode they are not part of the commit and stay uncommitted.
  - A path outside the repository or inside `workspace_dir` is an error; a missing path is skipped.

### `naming`

```yaml
naming:
  enabled: true             # let a model name the runs
  runtime: claude           # claude | opencode
  model: haiku              # a cheap model for titles
```

Right after a run starts, `aip` asks this model once in the background, with no tools and no MCP servers, to name the task. The run does not wait for the answer.

- The answer is a short title in the language of the task (up to 60 characters) and an English kebab-case name (up to 40 characters), for example "The --json flag for aip version" and `add-version-json-flag`.
- While there is no title, or if the call failed, the run is labeled with the first line of its task.
- The call costs a fraction of a cent and counts toward the run's cost.
- `aip run start --title "…"` sets the title at once. The model is not called then, and the name is built by transliterating the title.

### `outside_changes`

Before and after each step, `aip` compares the content of the files that differ from `HEAD` in your main working copy (`workspace_dir` is not part of the comparison).

- `warn` (the default) shows the changed files as a warning (`Warning: files in the working copy changed during step <step name>: …`) in `aip group show` and in the [panel](../web/runs.md#a-group), and the work continues;
- `stop` stops the group in `needs_human`; continue with `aip group answer`;
- `off` skips the comparison.

The list means "changed while the step ran", not "changed by the specialist": you or another program may have changed those files. A commit that does not edit a file, a change of only its modification time, and the deliveries `aip` itself makes do not count.

### `web`

The `web` section sets the panel of the daemon. It lives in the shared `settings.yaml` only: there is one panel per daemon, and one daemon per user. A change takes effect after the daemon restarts. Errors in other fields do not prevent reading this section.

```yaml
web:
  autostart: true           # the daemon starts the web panel together with itself
  auth: token               # token | none
  port: 7341                # 1..65535
  host: 127.0.0.1           # 127.0.0.1 | localhost | ::1
```

- **`autostart`** defaults to `true`. The daemon starts the panel on `host`:`port` and stops it together with itself.
  - The link to the panel is in the daemon log and in the `web.json` file of the state directory (permissions `0600`).
  - If the port is busy, the section has an error, or `AIP_WEB_TOKEN` is invalid, the daemon keeps working without the panel and writes the reason to its log.
  - `AIP_WEB_AUTOSTART=0` (or `false`) turns autostart off regardless of the configuration.
- **`auth`** is `token` by default: the page and the API require a token, and without it the answer is 401.
  - The token is `AIP_WEB_TOKEN` from the daemon's environment (that is, of the client that started it). Allowed characters are `A-Za-z0-9-_`, 16–128 of them.
  - Without the variable it is the token of the previous panel start from `web.json`, so the link survives a daemon restart. Otherwise it is a random one.
  - With `none` there is no token, the link is printed without `?token=`, and the page and the API answer everyone. `AIP_WEB_TOKEN` is ignored with a warning.
  - `none` gives every process and user on this machine control of the runs. On a multi-user machine keep `token`.
  - The `Host` and `Origin` checks stay on in both modes, and the server listens on loopback only.
- **`port`** and **`host`** are the address of the daemon's panel. `aip web` uses these values when you pass no `--port` and `--host`.

Opening and controlling the panel is described in [web/README.md](../web/README.md).

## `defaults`

Values for every specialist that does not set its own.

| Field | Values | Default |
|---|---|---|
| `runtime` | `claude`, `opencode` | `claude` |
| `permissions` | `read`, `edit`, `full` | `edit` |
| `timeout` | a duration: `90s`, `30m`, `2h` | `30m` |
| `allow_commands` | a list of command patterns | `[]` |
| `tools` | a list of runtime tools on top of the set for the permission level | `[]` |
| `mcp` | MCP servers of this specialist, `claude` runtime only | none |

The fields are described in [configuration/specialists.md](specialists.md#fields) and [configuration/permissions.md](permissions.md).

## Upgrading from `swarm.yaml`

`swarm.yaml` files and `swarm.d/` directories are not read. If a level has no file in the current format and an old file sits next to it, loading fails with the path it found and the directory it expected. Lay out the configuration by hand:

| In `swarm.yaml` | In `aip/` |
|---|---|
| `swarm.max`, `workspace_dir`, `outside_changes`, `workspace`, `naming`, `web`, `runtimes`, `network`, `claude`, `delivery`, `defaults` | `aip/settings.yaml`, without the `swarm:` root |
| `swarm.specialists.<slug>` | `aip/specialists/<slug>.yaml` |
| `swarm.pipelines.<id>` | `aip/pipelines/<id>.yaml` |
| shared `~/.config/aip/swarm.yaml` | these files in `~/.config/aip/` |
