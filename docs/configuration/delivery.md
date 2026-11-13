# Delivery

Delivery brings the merged result of a run to you. By default it happens by itself when the run finishes, and the changes appear in your working tree as uncommitted changes, ready for `git diff`.

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
  message_prompt: Write the message in English.   # appended to the task of the message author
  resolver_prompt: Keep the tests passing.        # appended to the task of the resolver
```

## Modes

- `worktree` (the default) puts the changes in your working tree as uncommitted changes and leaves the index alone.
- `commit` puts the changes in the working tree and makes one commit on the current branch, with the run's files only. Your other uncommitted edits are not touched. If anything is staged in the index, delivery refuses.
- `branch` creates an `aip/<run-id>` branch with the result and leaves the working tree alone.

In `commit` mode with the `working_tree` [base](README.md#workspace), a run file that contained your uncommitted edits goes into the commit as a whole; the delivery answer lists such files.

## Automatic and manual delivery

`auto` (default `true`) delivers right after the run finishes, with no command. With `auto: false`, delivery happens only through `aip run apply` or the `swarm_apply` tool, and the run frees its [queue place](../usage/queue.md#running-the-queue) as soon as it finishes.

```sh
aip run apply <run-id>            # all ready groups
aip run apply <run-id> login      # only these groups
```

While a run is still going, the panel's run header can switch its automatic delivery off with «Cancel auto delivery»; the result then waits for manual delivery.

Ready groups can be delivered in parts, and a group cannot be delivered twice. If delivery is refused, the group gets `apply_failed` with the reason, and you can repeat `aip run apply`. After you merged a result by hand, `aip run mark-delivered` marks the groups as delivered and applies nothing.

## Settings for one task

| Where | Mode | Auto delivery |
|---|---|---|
| `aip run start`, `aip queue add`, `aip queue edit` | `--delivery-mode <mode>` | `--auto-deliver`, `--no-auto-deliver` |
| `aip queue edit`, back to the setting's value | `--default-delivery-mode` | `--default-auto-deliver` |
| MCP tools | `deliveryMode` | `autoDeliver` |
| The panel's [task form](../web/queue.md#the-task-form) | "Delivery mode" | "Auto delivery" |

A task without a value takes `delivery.mode` and `delivery.auto` at the moment it starts. The panel's [queue modes](../web/queue.md#queue-modes) change the settings themselves.

## Safety

The run's changes are merged with the current content of your working tree, including uncommitted edits, using a three-way merge.

- If you edited other places in the same files, your edits stay together with the run's changes.
- If the merge conflicts and `resolver` is not set, delivery changes nothing and lists the files.
- New commits on your branch made after the run started do not interfere.
- `--force` (`force: true`) applies the changes and leaves the conflict markers in place. No commit is created in `commit` mode then.

## Resolving conflicts

With `resolver` set, `aip` resolves a delivery conflict with a step of this specialist.

1. `aip` snapshots your current working tree and applies the run's changes to the snapshot with conflict markers in a separate worktree.
2. The specialist gets the task, the group summaries and the list of conflicting files.
3. After its `done` with no markers left, the result is delivered by itself.

If the specialist fails, or you change the same lines again while it works, the attempt is repeated from a new snapshot until `resolver_rounds` is used up. Then the groups get `apply_failed` and the working tree stays unchanged. The resolver's state is visible in `aip run list` and on the [`System:` line](../usage/runs.md#following-a-run).

An example specialist:

```yaml
# aip/specialists/resolver.yaml
name: Resolver
prompt: |
  The files contain git conflict markers. Resolve every conflict so that both
  the user's edits and the changes from the task are kept. Remove all markers
  and run the project checks.
  Task: %s
```

## Commit messages

`commit_message` is the template for `commit` mode, with these substitutions:

- `{title}` is the title of the only group, or the first line of the task;
- `{task}` is the task text;
- `{run}` is the run identifier;
- `{pipeline}` is the pipeline name (`{workflow}`, the name used before, means the same);
- `{groups}` is the list of groups with their results.

With `message_specialist`, this specialist writes the message before the commit, from the task, the group summaries and the list of changed files. If it fails, the template is used.

`message_prompt` is appended to the task of `message_specialist`, and `resolver_prompt` to the task of the `resolver`.

## Cleanup

After all ready groups are delivered, the worktrees and internal refs are removed; logs and history stay. `keep: true` turns the cleanup off, and [`aip run clean`](../usage/runs.md#cleaning-up) removes them by hand.

A failed or cancelled delivery step (`_message`, `_resolve`) is repeated through `aip run apply`.

Commands can also run after delivery, see [Pipeline actions](actions.md). With a failed action after delivery the result stays delivered and the cleanup waits.
