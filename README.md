# aip

`aip` runs a swarm of AI agents on your repository. You describe the specialists (coder, reviewer, QA…) and the order they work in. `aip` starts them in Claude Code or OpenCode, gives every group of work its own git worktree, and puts the final diff into your working tree when it is done. You follow and control the work from Claude Code, OpenCode, the terminal or a web panel.

## What it does

- **Specialists and workflows** — agents with their own prompt, model and permissions, chained into steps with review loops and human checkpoints. → [docs/configuration/specialists.md](docs/configuration/specialists.md), [docs/configuration/workflows.md](docs/configuration/workflows.md)
- **Isolated runs** — every group of work has its own worktree. Your branch, index and working tree stay untouched while the swarm works. → [docs/getting-started/concepts.md](docs/getting-started/concepts.md), [docs/usage/runs.md](docs/usage/runs.md)
- **Delivery** — the result reaches you as uncommitted changes, one commit or a branch, merged with your own edits; a specialist can resolve conflicts. → [docs/configuration/delivery.md](docs/configuration/delivery.md)
- **Task queue** — tasks run one after another or in parallel, with dependencies, an autopilot and waiting out usage limits. → [docs/usage/queue.md](docs/usage/queue.md), [docs/usage/tags.md](docs/usage/tags.md)
- **Permissions** — levels per specialist, an allowlist of commands, and hints for what was denied. → [docs/configuration/permissions.md](docs/configuration/permissions.md)
- **Claude Code and OpenCode** — MCP tools in both hosts, and a panel, status line and commands in Claude Code. → [docs/hosts/claude-code.md](docs/hosts/claude-code.md), [docs/hosts/opencode.md](docs/hosts/opencode.md), [docs/hosts/mcp-tools.md](docs/hosts/mcp-tools.md)
- **Web panel** — follow runs, answer specialists, manage the queue and edit the configuration in a browser. → [docs/web/README.md](docs/web/README.md)
- **Many repositories** — one daemon serves all of them, each with its own configuration and queue. → [docs/usage/repositories.md](docs/usage/repositories.md)

## Requirements

- Node.js 24 or newer and git 2.20 or newer;
- `claude` (Claude Code) and/or `opencode` in `PATH`.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/hoknie/ai-pipeline/main/scripts/install.sh | sh
# or, without the script:
npx @hoknie/aip@latest setup
```

This installs the `aip` command and connects it to Claude Code and OpenCode. Details, options, update and removal: [docs/getting-started/install.md](docs/getting-started/install.md).

## Quick start

1. In your repository, create a starter configuration:

   ```sh
   aip init
   ```

   It writes `aip/settings.yaml`, two specialists and a workflow. Settings first:

   ```yaml
   max: 2
   defaults:
     allow_commands: ["npm test*"]
   ```

   The workflow `aip/workflows/feature.yaml`: write the code, then review it.

   ```yaml
   steps:
     - { id: code, specialist: coder }
     - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 2 } }
   ```

2. Check the setup, start a task and watch it:

   ```sh
   aip config check
   aip run start feature --task "Add a login form"
   aip run watch
   ```

3. When the run is finished, its changes are in your working tree as uncommitted changes:

   ```sh
   git diff        # review and commit it yourself
   ```

Next: [how aip works](docs/getting-started/concepts.md) and [running tasks](docs/usage/runs.md).

## Documentation

- [docs/](docs/README.md) — guides for every feature, the configuration and command reference, and development.
- `aip <command> --help` — the options of a command.
- [CHANGELOG.md](CHANGELOG.md) — what changed in each version.
