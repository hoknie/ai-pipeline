# Claude Code

`aip` works in Claude Code in two ways: the MCP server gives the model the [`swarm_*` tools](mcp-tools.md), and the `aip` plugin adds a panel, a status line, notifications and commands.

`aip setup` connects both (see [getting-started/install.md](../getting-started/install.md#what-aip-setup-does)). As a runtime for specialists, Claude Code is described in [configuration/runtimes.md](../configuration/runtimes.md).

## Connect by hand

```sh
claude mcp add --scope user aip -- aip mcp
```

To check, run `claude mcp list` in a new session. It shows `aip`, and the tool list has `swarm_*`. To attach the server to a single session without registering it:

```sh
claude --mcp-config '{"mcpServers":{"aip":{"type":"stdio","command":"aip","args":["mcp"]}}}'
```

## Install the plugin

`aip setup` installs the plugin from the marketplace in the package. Without npm, run this in Claude Code:

```
/plugin marketplace add hoknie/ai-pipeline
/plugin install aip@aip
```

To load the plugin from the repository folder without installing it:

```sh
claude --plugin-dir /path/to/ai-pipeline/integrations/claude-code
```

To load it in every session, add the folder to `env` in `~/.claude/settings.json`:

```json
{
  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/ai-pipeline/integrations/claude-code" }
}
```

The MCP server is connected separately (see [above](#connect-by-hand)).

### The path to aip

The plugin calls `aip` from `PATH`. If the command is not installed through `npm link` (for example, Node is installed through nvm), give the path in the plugin option `aipCommand`, in the plugin settings menu or in `~/.claude/settings.json`:

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

## Commands

- `/aip:run <workflow> <task>` starts a run in the repository of the current session;
- `/aip:status [run-id]` lists the runs (icon, title, `id`, `3/5`, diff, cost) or the groups of one run, in Markdown;
- `/aip:apply <run-id> [group...] [--force]` delivers a run;
- `/aip:panel` opens the panel, `/aip:panel close` closes it;
- `/aip:web [start|stop|restart|status] [--port <n>]` manages `aip web` for the session's repository.

The plugin draws `swarm_*` tool calls in the chat as one line, for example `aip · status — 1 active: Add login 3/5 · 1 needs answer`. The text the model receives does not change, and Ctrl+O shows the full output.

### `/aip:web`

- With no arguments (or `start`) it starts `aip web` and replies with the link `aip web: http://127.0.0.1:7341/?token=…`.
- A second `start` returns that link. `status` shows it, or "aip web is not running.". `stop` stops the server.
- The server lives while the Claude Code session is open.
- After `restart` the token is new and the port stays.
- Ports, the daemon's panel and `stop` are described in [web/README.md](../web/README.md#open-the-panel).

## The panel

The panel lets you control the swarm in the Claude Code window. It does not open by itself: use `/aip:panel`.

### What the panel shows

The header is `aip · 2 active · 1 needs you`, with a connection indicator: `● live` for the event stream, `◌ polling` for polling, `✕ offline` when aip is not found.

- **Needs you.** A frame under the header. The questions of the selected run are expanded in it, with the text, the options and an answer field. Other things that wait for you (questions of other runs, a conflict, a failure, a rejected delivery) are one-line items, at most five, the rest collapse into `+N more`. With nothing to decide, the frame is hidden.
- **Runs.** Active runs first, finished ones dimmed, the selected one marked with `›`. A row has a status icon, the title (the `id` if there is none), a progress bar `▰▰▰▰▰▰▱▱▱▱ 3/5`, the age and the cost. The keys `1`–`8` select the first eight runs.
- **The selected run.** The title with a status icon, and "cancel run" and "apply run" buttons when they make sense. One line shows `id · workflow · phase · diff · delivery · cost`. Below are the groups, ordered by urgency: waiting for you, failed and conflicting, running, queued, merged and cancelled.
- **A group.** An icon and a status label, the step, round, time, diff and delivery, and the failure reason as the first line.
- **A group's question.** If the agent asked [structured questions](../configuration/workflows.md#questions), each one has buttons with options and a field for your own answer. The recommended option is marked `recommended` and is put in the field by default. "answer" sends all the answers as one text. While some question has no answer, the panel names its number and sends nothing.
- **Buttons.** "retry" for a failed group and a group with a conflict, "cancel" for a group in progress, "apply" for a merged group that is not delivered yet. For a run with a single group, cancel and apply are shown only on the run.
- **Result of an action.** One line under the header. `✓ …` disappears after 8 seconds, `✕ …` stays until the next action.

The status icons are `○` queued, `◐` running, `?` waiting for you, `⇄` merging, `●` merged, `⚠` conflict, `✕` failure, `⊘` cancelled. Colors come from the Claude Code theme.

The panel updates from the `aip events --json` stream. Besides runs, queues, repositories and tags it carries the `processes` event with the `processes` list of background processes of the agents (or an `error` string when the process table cannot be read); the daemon sends it when the list changes. If the stream breaks, the panel polls every 2 seconds and reconnects by itself.

## Status line

The status line shows the state through the whole session:

- `aip: idle`, `aip: connecting`, `aip: offline`;
- `aip: Add login · 2 running · 1 question` for one active run (a title over 30 characters is cut);
- `aip: 2 runs · 1 running · 1 failed` for several.

The counters `running`, `question(s)`, `failed` and `conflict` are shown only when they are not zero.

## Notifications

A notification appears once for each event: a group waits for an answer, fails or gets a conflict, a run finishes, a delivery is rejected.
