# `aip/` configuration

## Where the configuration lives

The configuration is an `aip/` directory. There are two of them:

- shared: `$XDG_CONFIG_HOME/aip/`, or `~/.config/aip/` if the variable is not set;
- project: `aip/` in the root of a git repository.

You can edit the specialist and workflow files of both levels from the `aip web` panel.

Inside the directory:

```
aip/
  settings.yaml          # max, delivery, workspace, defaults … (no swarm: root)
  specialists/
    coder.yaml           # the coder specialist
    reviewer.yaml        # the reviewer specialist
  workflows/
    feature.yaml         # the feature workflow
```

Every specialist and every workflow has exactly one file. The specialist slug and the workflow id are the file name without the extension (`coder.yaml` → `coder`) and must match `^[a-z][a-z0-9-]{0,31}$`. The file holds the body of the entry without a key for its name: `name`, `model`, `prompt` … for a specialist, `steps` and `split` for a workflow. `settings.yaml` holds the fields of the former `swarm:` root, without the root itself and without `specialists` and `workflows`. Files named `*.yaml` and `*.yml` directly in `specialists/` and `workflows/` are read by file name (and `settings.yaml` or `settings.yml` in `aip/`). Subdirectories, hidden files and files with other extensions are skipped. A pair `x.yaml` and `x.yml` is a validation error that names both files. A symlink to a file is read.

All files are optional, but at least one must exist on one of the levels. The project level overrides the shared one:
- `max`, `workspace_dir` and `outside_changes` as a whole;
- `defaults`, `claude`, `delivery`, `workspace` and `naming` field by field;
- `web` is read from the shared level only;
- specialists and workflows as a whole, by name: a project file `coder.yaml` replaces the shared one.

Unknown keys are an error. `aip config check` prints all errors at once, each with the file and the path to the field. For a valid configuration it prints the result, the list of files read in merge order (`Config files:`: on each level `settings.yaml` first, then specialists and workflows by name; the shared level before the project level) and the versions of the agent CLIs it found. A running run keeps a snapshot of the configuration, so editing the files does not affect it.

## Migrating from `swarm.yaml`

`swarm.yaml` files and `swarm.d/` directories are no longer read. If a level has no file in the new format and an old file sits next to it, loading fails with the path it found and the directory it expected. There is no automatic migration; lay out the configuration by hand:

| In `swarm.yaml` | Now |
|---|---|
| `swarm.max`, `workspace_dir`, `outside_changes`, `workspace`, `naming`, `web`, `claude`, `delivery`, `defaults` | `aip/settings.yaml`, without the `swarm:` root |
| `swarm.specialists.<slug>` | `aip/specialists/<slug>.yaml` |
| `swarm.workflows.<id>` | `aip/workflows/<id>.yaml` |
| shared `~/.config/aip/swarm.yaml` | the same files in `~/.config/aip/` |

## The `settings.yaml` root

```yaml
max: 3                    # specialists running at once on the machine, 1..32
workspace_dir: .aip       # worktrees and logs: relative to the repository root, or an absolute path
outside_changes: warn     # warn | stop | off
workspace: { ... }
naming: { ... }
web: { ... }         # shared directory only
claude:
  edit_mode: allowlist    # allowlist | accept_edits | auto
  mcp: isolated           # isolated | inherit
  settings: isolated      # isolated | inherit
delivery: { ... }
defaults: { ... }
```

Specialists and workflows live in their own directories, not in `settings.yaml`.

`max` is the global limit across all runs. The value from the configuration of the most recently created run applies.

### `workspace`

```yaml
workspace:
  base: working_tree        # working_tree | head
  include:                  # paths that git ignores but specialists need
    - notes/
    - .plans/
```

- **`base`** is what a run starts from:
  - `working_tree` (the default) starts from a snapshot of your working tree at the moment of the run: the last commit plus uncommitted edits, deletions and new files (except those git ignores). Specialists continue from where you stopped. The snapshot does not touch your branch, index or working tree;
  - `head` starts from the last commit, without uncommitted edits; the run warns you if there are any.
- **`include`** lists paths, relative to the repository root, that go into the run even though git ignores them, such as notes and plans you do not keep in history. Specialists' edits to them are delivered together with the rest, but in `commit` mode they are not part of the commit and stay uncommitted. A path outside the repository or inside `workspace_dir` is an error; a missing path is skipped.

### `naming`

```yaml
naming:
  enabled: true             # let a model name the runs
  runtime: claude           # claude | opencode
  model: haiku              # a cheap model for titles
```

Right after a run starts, `aip` asks this model once in the background, with no tools and no MCP servers, to name the task. The answer is a short title in the language of the task (up to 60 characters) and an English kebab-case name (up to 40 characters), for example "The --json flag for aip version" and `add-version-json-flag`. The run does not wait for the answer. While there is no title, or if the call failed, the run is labeled with the first line of its task. The call costs a fraction of a cent and counts toward the run's cost. `aip run --title "…"` sets the title at once; then the model is not called, and the name is built by transliterating the title.

### `web`

```yaml
web:
  autostart: true           # the daemon starts the web panel together with itself
  auth: token               # token | none
  port: 7341                # 1..65535
  host: 127.0.0.1           # 127.0.0.1 | localhost | ::1
```

- **`autostart`** defaults to `true`. The daemon (it starts by itself on any `aip` command) starts the web panel on `host`:`port` and stops it together with itself. The link to the panel is in the daemon log and in the `web.json` file of the state directory (permissions `0600`). If the port is busy, the section has an error, or `AIP_WEB_TOKEN` is invalid, the daemon keeps working without the panel and writes the reason to its log. The environment variable `AIP_WEB_AUTOSTART=0` (or `false`) turns autostart off regardless of the configuration. `aip web start` raises the panel even when autostart is off, and `aip web stop` stops it until the next start of the daemon.
- **`auth`** is `token` by default: the page and the API require a token, and without it the answer is 401. The daemon panel's token is `AIP_WEB_TOKEN` from the daemon's environment (that is, the client that started it); otherwise the token of the previous panel start from `web.json`; otherwise a random one. With `none` there is no token, the link is printed without `?token=`, and the page and the API answer everyone. The `Host` and `Origin` checks stay on in both modes, and the server listens on loopback only. `none` gives every process and user on this machine control of the runs, so on a multi-user machine keep `token`. With `none`, `AIP_WEB_TOKEN` is ignored with a warning.
- **`port`** and **`host`** are the address of the daemon's panel. `aip web` uses the same values when you pass no `--port` and `--host`.

This section is set in the shared `settings.yaml` only: there is one panel per daemon, and one daemon per user. In a project `aip/settings.yaml` it is a validation error (`swarm.web`). Errors in other fields do not prevent reading the `web` section. A change takes effect after the daemon restarts.

### `outside_changes`

Before and after each step, `aip` compares the `git status` of your main working copy (`workspace_dir` is not part of the comparison):
- `warn` (the default) shows the changed files as a warning in `aip group` and as a separate collapsible block in the `aip web` panel, and the work continues;
- `stop` stops the group in `needs_human`; continue with `aip group answer`;
- `off` skips the comparison.

### `delivery`

```yaml
delivery:
  mode: worktree            # worktree | commit | branch
  auto: true                # deliver right after the run finishes
  keep: false               # keep worktrees and internal refs after delivery
  commit_message: |         # template for mode: commit
    {title}

    {groups}
  message_specialist: writer   # optional: this specialist writes the commit message
  resolver: writer          # optional: this specialist resolves delivery conflicts
  resolver_rounds: 1        # how many times to try to resolve a conflict, 1..10
```

- **`mode`** is how the result reaches you:
  - `worktree` (the default) puts the changes in your working tree as uncommitted changes and leaves the index alone;
  - `commit` does the same and also makes one commit on the current branch, with the run's files only. Your other uncommitted edits are not touched, and if anything is staged in the index, delivery refuses;
  - `branch` creates an `aip/<run-id>` branch with the result and leaves the working tree alone.
- Delivery is started by the `aip run apply <run-id> [group...]` command or the `swarm_apply` tool. Ready groups can be delivered in parts, and a group cannot be delivered twice.
- **Safety.** The run's changes are merged with the current content of your working tree, including uncommitted edits, using a three-way merge: if you edited other places in the same files, your edits stay together with the run's changes. If the merge conflicts and `resolver` is not set, delivery changes nothing and lists the files. New commits on your branch made after the run started do not interfere. `--force` (`force: true`) applies the changes and leaves the conflict markers in place; no commit is created in `commit` mode then.
- **`auto`** (default `true`) delivers right after the run finishes, with no command. If delivery is refused, the group gets `apply_failed` with the reason, and you can repeat `aip run apply`. With `auto: false`, delivery happens only through `aip run apply`. You can override the value for one task: `aip run start --auto-deliver` / `--no-auto-deliver`, the same on `aip queue add` and `aip queue edit` (`--default-auto-deliver` returns to the setting's value), the `autoDeliver` parameter of the MCP tools, and the "Auto delivery" switch in the panel's queue form. A task without a value takes `delivery.auto` at the moment it starts. A run without auto-delivery frees its queue place as soon as it finishes. In the panel (`aip web`), the general settings screen switches `delivery.auto` and writes it to the shared `settings.yaml`; if the field is set in the project file, the switch is unavailable.
- **`resolver`**: when delivery hits a conflict, `aip` snapshots your current working tree, applies the run's changes to the snapshot with conflict markers in a separate worktree, and runs a step of this specialist there. The specialist gets the task, the group summaries and the list of conflicting files. After its `done` with no markers left, the result is delivered by itself. If the specialist fails, or you change the same lines again while it works, the attempt is repeated from a new snapshot until `resolver_rounds` is used up. Then the groups get `apply_failed` and the working tree stays unchanged. The resolver's state is visible in `aip run list`. An example specialist:

  ```yaml
  # aip/specialists/resolver.yaml
  name: Resolver
  prompt: |
    The files contain git conflict markers. Resolve every conflict so that both
    the user's edits and the changes from the task are kept. Remove all markers
    and run the project checks.
    Task: %s
  ```
- In `commit` mode with the `working_tree` base, a run file that contained your uncommitted edits goes into the commit as a whole; the delivery answer lists such files.
- **`commit_message`** substitutions:
  - `{title}` is the title of the only group, or the first line of the task;
  - `{task}` is the task text;
  - `{run}` is the run identifier;
  - `{workflow}` is the workflow name;
  - `{groups}` is the list of groups with their results.
- **`message_specialist`**: before the commit, this specialist writes the message from the task, the group summaries and the list of changed files. If it fails, the template is used.
- After all ready groups are delivered, the worktrees and internal refs are removed; logs and history stay. `keep: true` turns the cleanup off.

### `claude.mcp`

- `isolated` (the default): the `claude` specialist sees only the `aip` server, with none of the MCP servers from your Claude Code settings.
- `inherit`: the specialist can use your servers too.

### `claude.settings`

- `isolated` (the default): the `claude` specialist starts without your user-level Claude Code settings (`~/.claude/settings.json`). Your hooks, plugins and permission rules do not apply to it. So a hook that rewrites shell commands (for example, `npm run check` into `rtk npm run check`) does not break the `allow_commands` patterns. The project settings (`.claude/settings.json` and `.claude/settings.local.json` in the repository) and `CLAUDE.md` still apply. Your Claude Code login is not affected.
- `inherit`: the specialist reads your settings as well. Use it if the specialist needs `env` or `apiKeyHelper` from `~/.claude/settings.json`.

The one-off call that makes up a run title always goes without your settings.

### `claude.edit_mode`

Sets how the `claude` runtime gets the `edit` level:
- `allowlist` (the default) is an explicit list of tools: reading, searching, editing files, and the commands from `allow_commands`. Other shell commands are rejected;
- `accept_edits` is the Claude Code mode that accepts edits automatically. In it, file system commands such as `rm` and `mv` run even without `allow_commands`. Other shell commands still have to be listed in `allow_commands`;
- `auto` is the Claude Code `auto` mode. Claude Code's classifier judges every action: ordinary work (building, testing, reading, editing files) runs without patterns, while anything the classifier considers risky (for example, sending files out) is rejected. A rejected action shows up as a permission denial of the attempt. Commands from `allow_commands` are allowed in advance. The classifier does not keep the specialist inside the worktree: it lets writes to the home directory through. That is why `auto` is not the default and `aip config check` warns about it.

`git push`, `git checkout` and `git switch` are forbidden in all modes. The mode does not affect the `read` and `full` levels.

## `defaults`

| Field | Values | Default |
|---|---|---|
| `runtime` | `claude`, `opencode` | `claude` |
| `permissions` | `read`, `edit`, `full` | `edit` |
| `timeout` | a duration: `90s`, `30m`, `2h` | `30m` |
| `allow_commands` | a list of command patterns | `[]` |
| `tools` | a list of runtime tools on top of the set for the permission level | `[]` |

## Specialists

The file `aip/specialists/plan.yaml` (the slug `plan` comes from the file name and matches `^[a-z][a-z0-9-]{0,31}$`):

```yaml
name: Planner             # required
runtime: claude           # otherwise from defaults
model: opus               # passed to the runtime as is
permissions: read
timeout: 20m
allow_commands: ["npm test*"]
tools: [WebFetch]         # tools on top of the set for the permission level
skills: [grill-me, "review:pr"]
max: 1                    # at most one such specialist at a time
queue: false              # true: may add tasks to the queue (swarm_queue_add)
prompt: |
  Write a plan: %s
```

- `max` is an integer from 1 to 32: how many specialists with this slug may work at once on the machine, across all runs. This way several groups can plan at the same time while a single coder writes the code. Without the field a specialist has no limit of its own, and only `swarm.max` applies. A group that needs a busy specialist stays in the `queued` status and does not hold back other groups whose specialists are free. The limit also applies to the task split (`split`), the commit message and the resolver. It is not inherited from `defaults` and does not interrupt specialists that are already working.

- `queue`: `true` gives the specialist the MCP tool `swarm_queue_add`. It puts a task at the end of the queue of the run's repository (not of its own worktree), like `aip queue add`, with `workflow`, `task` or `groups`, and an optional `title`. The queue does not start. `after` takes ids of queue items or runs that must be done first, for example the ids returned by earlier `swarm_queue_add` calls, so a specialist can queue a chain: a model first, then the API after it. This way the last step of a workflow can pass results on, for example by queueing a `feature` task for each prepared change. An unknown workflow, invalid parameters, or a call after the attempt has ended return an error to the specialist. The default is `false`. The field cannot be set in `defaults`; the permission is given to each specialist explicitly. For Claude the tool is allowed in advance at every permission level.
- `model` is a model name in the runtime's format: `opus`, `sonnet` or a full id for Claude; `provider/model` for OpenCode. Without `model` the runtime's default model is used.
- `skills` tells the specialist to use these skills. If a skill is not found in the runtime's directories (`.claude/skills`, `~/.claude/skills`, `~/.config/opencode/skills` and so on), a warning goes to the step log, and the step still starts. The panel suggests skills from the same directories (`SKILL.md` in subdirectories, and command files `.md`, nested ones as `directory:command`) and marks whether each comes from the repository or the home directory.
- `tools` are Claude tools added to the set for the permission level (see below), for example `WebFetch`, `WebSearch` or `Task`. A value on a specialist replaces the value from `defaults`. The panel suggests names from the catalog: Claude's built-in tools and the `mcp__<server>` servers from the repository's `.mcp.json` and `~/.claude.json`. A value that is not in the catalog is typed by hand.
- `prompt`: every `%s` is replaced by the group's task, and `%%` gives a literal `%`. If there is no `%s`, the task is added as a separate paragraph. Without `prompt` the specialist gets only the task.

### Permission levels

| Level | `claude` | `opencode` |
|---|---|---|
| `read` | tools `Read`, `Grep`, `Glob` | `edit: deny`, `bash: deny` |
| `edit` | editing files and `Bash(<pattern>)` for each command in `allow_commands` (or `acceptEdits` and `auto`, see above) | `edit: allow`, `bash`: everything denied except `allow_commands` |
| `full` | `--dangerously-skip-permissions` | `--auto`, `bash: allow` |

A Claude specialist gets only the tools of its level: at `read`, `Read`, `Grep` and `Glob`; at `edit` and `full`, also `Edit`, `MultiEdit`, `Write`, `NotebookEdit` and `Bash`. If `skills` is set, `Skill` is added, and `tools` adds the ones listed. Other built-in Claude tools are not passed to the specialist, because their descriptions would take up context on every turn. The `swarm_report` tool is loaded at once, without a tool search.

`git push` is forbidden at every level, and `git checkout` and `git switch` are also forbidden at `read` and `edit`. The `full` level is enabled only explicitly. `aip config check` warns about every specialist with `full`.

### Denials and new permissions

A run works from the configuration snapshot taken when it starts. Specialist permissions (`permissions`, `allow_commands`, `tools`, `queue` and `claude.edit_mode`) are read again from the current `aip/` files on `aip group retry` and `aip group answer` (and on a retry or an answer from the panel or through MCP). The new permissions apply to all following steps of all groups of the run. Prompts, models, workflows and other settings stay as in the snapshot. If the configuration does not pass validation, the retry or the answer goes ahead with the old permissions, and the group gets the warning `permissions not refreshed: …`.

Commands that Claude Code rejected are shown in `aip group` under the attempt (`denied: …`) and in the panel. For every rejected command a pattern for `allow_commands` is shown. A compound command (`a && b`, `a | b`, `a; b`) passes only if every part matches a pattern, so a pattern is suggested for every part that is not allowed. The `Permission hints:` line of a group collects the patterns that the specialists' permissions do not have yet:

```
     denied: Bash cd w && claude plugin test integrations/claude-code → claude plugin *
Permission hints: add to allow_commands: 'claude plugin *' (a retry or an answer picks them up)
```

Loops and here-documents cannot be allowed by a pattern; for them the output says `no pattern allows it` instead of a pattern. The `opencode` runtime does not report denials.

## Workflow

The file `aip/workflows/feature.yaml` (the id `feature` is the file name):

```yaml
split:                                       # optional
  specialist: plan
  max_groups: 5
  additional_prompt: At most one group per module.
steps:
  - id: code
    specialist: coder
  - id: review
    specialist: reviewer
    on_reject: { goto: code, max_rounds: 3 }
    additional_prompt: Check only the tests and the error handling.
```

- `additional_prompt` on a step (and on `split` for the split specialist) is appended as a separate paragraph after the specialist's prompt with the task filled in, and before the `aip` service instructions. This way one specialist behaves differently in different steps without copies: for example, a reviewer checks only the tests in one step. The text is taken as is: `%s` and `%%` are not substituted in it. State any narrowing explicitly, because the step's text comes after the specialist's prompt and closer to the task.
- The steps of a group go strictly in order. Groups of one run work in parallel, within `max`.
- Every specialist ends a step by calling `swarm_report` with a verdict:
  - `done` moves on to the next step;
  - `rejected` goes back to the `goto` step together with the remarks;
  - `needs_human` stops with a question: as text in `feedback` or as a structured list in `questions`.
- `questions` in `swarm_report` (only with `needs_human`) holds 1 to 10 independent questions in one report. A question has a `text` (up to 2000 characters), optional `options` (1 to 6 choices of up to 200 characters each) and a `recommendation` (up to 2000 characters), the recommended answer. If `feedback` is empty, it is filled with the numbered text of the questions, so `aip run list`, `aip group` and `aip group answer` work as with a plain question. The human's answer reaches the specialist as one text: `Q1: …` / `A1: …` for each question.
- A step that ends without `swarm_report`, or on `timeout`, gets the `failed` status; you can retry it with `aip group retry`.
- A run in which the split step or a work group failed (or the delivery of a merged group ended in `apply_failed`) is shown as `failed`; `cancelled` takes precedence.
- A run in which at least one work group (or the split step) was cancelled is shown as `cancelled`. `aip group retry` continues a cancelled group from the interrupted step; cancelled deliveries (`_message`, `_resolve`) are repeated through `aip run apply`.
- `on_reject.goto` must point to an earlier step. After `max_rounds` returns the group goes to `needs_human`. A `rejected` verdict on a step without `on_reject` also leads to `needs_human`.
- `split` divides a task into groups. If a run is created from a single text (`--task`), the `split.specialist` works first: it proposes from 1 to `max_groups` groups with the `swarm_split` tool, and each group goes through all the steps. If the groups are passed as a list (`--groups`), the split is skipped. In commands the split step is called the `_split` group. After the split (and when groups are passed as a list), each group starts at the first step of its own workflow, or, with `split.workflow`, at the first step of the named workflow.

### Groups that follow another workflow's steps

The `split.workflow` field names the workflow whose steps the groups follow after the split. Such a workflow has no steps of its own: `steps` and `split.workflow` are mutually exclusive. A workflow cannot target itself, and the target cannot have a `split.workflow` of its own (no chains). A workflow that `split.workflow` refers to cannot be deleted.

```yaml
# aip/workflows/epic.yaml
split:
  specialist: plan
  workflow: explore
```

The groups of the epic go through the steps of the `explore` workflow. Changing `explore` after a run has started does not affect that run, because the steps come from the configuration snapshot.

In the panel's workflow form this is the "Group steps" choice in the split block: "Own steps" or the id of another workflow. When a target is chosen, the step list is hidden and a link to the target's form takes its place, and saving writes `split.workflow` without `steps`.

## What a specialist receives

The message to a specialist contains:
- its prompt with the task, and the step's `additional_prompt` if there is one;
- the summaries of the group's previous steps;
- the remarks of the specialist who rejected the work, after a return;
- the human's answer, after `needs_human`.

If the runtime can continue a session (Claude Code always, OpenCode by session id), the session continues after the human's answer.
