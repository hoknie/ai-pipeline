# Documentation

New to `aip`? Install it, read [how it works](getting-started/concepts.md), then start a task with the [quick start](../README.md#quick-start).

## Getting started

| Page | What it covers |
|---|---|
| [getting-started/install.md](getting-started/install.md) | installing, connecting hosts, updating, removing, common problems |
| [getting-started/concepts.md](getting-started/concepts.md) | how a run works: specialists, pipelines, groups, steps, the queue, delivery, the daemon |

## Configuring

| Page | What it covers |
|---|---|
| [configuration/README.md](configuration/README.md) | the `aip/` directory, shared and project levels, `settings.yaml`, `defaults`, the `web` section |
| [configuration/specialists.md](configuration/specialists.md) | the fields of a specialist: prompt, model, limits, skills, tools, MCP servers, queueing tasks, tags |
| [configuration/pipelines.md](configuration/pipelines.md) | steps, verdicts, returns, human review, questions, splitting a task into groups |
| [configuration/actions.md](configuration/actions.md) | pipeline actions: commands and specialist steps around the split and the delivery, points, environment |
| [configuration/permissions.md](configuration/permissions.md) | permission levels, `claude.edit_mode`, denied commands and how to allow them |
| [configuration/delivery.md](configuration/delivery.md) | how a result reaches you: modes, safety, conflicts and the resolver, commit messages |
| [configuration/runtimes.md](configuration/runtimes.md) | which agent CLI starts and how: `runtimes`, `claude.mcp`, `claude.settings` |

## Running work

| Page | What it covers |
|---|---|
| [usage/runs.md](usage/runs.md) | starting, following, answering, retrying and cleaning up runs; run states; artifacts |
| [usage/queue.md](usage/queue.md) | the task queue: order, parallelism, autopilot, usage limits, dependencies, pausing and freezing |
| [usage/tags.md](usage/tags.md) | tags of tasks and runs, linked tasks, the parent of a task |
| [usage/repositories.md](usage/repositories.md) | one daemon for several repositories |
| [usage/daemon.md](usage/daemon.md) | controlling the daemon, replacing an old build, where files live |
| [usage/cli.md](usage/cli.md) | every command |

## Hosts

| Page | What it covers |
|---|---|
| [hosts/claude-code.md](hosts/claude-code.md) | connecting Claude Code; the plugin: panel, status line, notifications, commands |
| [hosts/opencode.md](hosts/opencode.md) | connecting OpenCode, tool names, troubleshooting |
| [hosts/mcp-tools.md](hosts/mcp-tools.md) | the `swarm_*` tools of hosts and specialists |

## Web panel

| Page | What it covers |
|---|---|
| [web/README.md](web/README.md) | opening and controlling the panel, security, the status strip, keyboard and look |
| [web/runs.md](web/runs.md) | the "Runs" section: filters, a run, a group, its log, answering questions |
| [web/queue.md](web/queue.md) | the "Queue" section: the task form, reordering, the queue modes |
| [web/config.md](web/config.md) | the "Topology", "Specialists" and "Pipeline" sections |
| [web/settings.md](web/settings.md) | the "Settings" section: shared and project forms, shared specialists and pipelines, the system group |
| [web/http-api.md](web/http-api.md) | the HTTP API behind the panel |

## Development

| Page | What it covers |
|---|---|
| [development.md](development.md) | checking and building `aip`, the panel from source, releases |
