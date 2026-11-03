# aip

`aip` runs a swarm of AI agents on your repository. You describe the specialists (coder, reviewer, QA…) and the order they work in. `aip` starts them in Claude Code or OpenCode, gives every group of work its own git worktree, and puts the final diff into your working tree when it is done. You follow and control the work from Claude Code, OpenCode or the terminal.

## Requirements

- Node.js 24 or newer and git 2.20 or newer;
- `claude` (Claude Code) and/or `opencode` in `PATH`.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/hoknie/ai-pipeline/main/scripts/install.sh | sh
# or, without the script:
npx @hoknie/aip@latest setup
```

This installs the `aip` command and connects it to Claude Code and OpenCode. Details, options, update and removal: [docs/install.md](docs/install.md).

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

## Learn more

- [docs/install.md](docs/install.md): installation, update, removal, common problems;
- [docs/configuration.md](docs/configuration.md): every field of `aip/`;
- [docs/cli.md](docs/cli.md): commands and the daemon;
- [docs/queue.md](docs/queue.md): task queue, autopilot, tags;
- [docs/hosts.md](docs/hosts.md): Claude Code, OpenCode, MCP tools;
- [docs/web.md](docs/web.md): the web panel;
- [docs/development.md](docs/development.md): working on `aip` itself (`npm run check`).
