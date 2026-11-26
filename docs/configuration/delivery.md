# Delivery

Delivery brings the merged result of a run to you. By default it happens by itself when the run finishes, and the changes appear in your working tree as uncommitted changes, ready for `git diff`.

```yaml
delivery:
  mode: worktree            # worktree | commit | branch
  auto: true                # deliver right after the run finishes
  push: false               # send the branch aip/<run-id> to the remote repository
  remote: origin            # the remote repository of the delivery
  base_branch: main         # server mode: the main branch runs start from
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
- `commit`, without a target branch, puts the changes in the working tree and makes one commit on the current branch, with the run's files only. Your other uncommitted edits are not touched. If anything is staged in the index, delivery refuses.
- `branch` creates an `aip/<run-id>` branch with the result and leaves the working tree alone.

For a local task with automatic delivery in `commit` mode, an optional target
branch directs the delivery commit to a different local branch without checking
it out. Choose an existing branch (`existing`) or explicitly request a new one
(`create`). Without a target, `commit` keeps its usual current-branch behavior.
The target is not available for manual delivery except when retrying a failed
automatic delivery. It is unavailable for other modes and server mode; it is
separate from the `branch` delivery mode and does not push a branch.

An existing target must descend from the source commit recorded when the run
started and must not be checked out in any worktree. A new target starts from
the current tip of the run's source branch, which must still exist and descend
from that source commit; the new branch is created only when delivery succeeds.
Conflicts, an occupied branch or a concurrent update leave the target unchanged
and allow a retry. A configured `resolver` is not used for target-branch
conflicts, and `--force` cannot write conflict markers to a target branch. If auto
delivery is cancelled, a later manual delivery uses the usual current branch,
not the saved target. An unsuccessful automatic delivery can be retried with
`aip run apply` while auto delivery remains enabled.

In [server mode](server.md#authors-and-commits) only `branch` is allowed, see [Server mode](#server-mode); its commit is by the person whose task it was.

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

For an automatically delivered `commit` task, MCP and IPC accept
`deliveryBranch: {name: "feature/profile", strategy: "existing"}` to use an
existing local branch, or `deliveryBranch: {name: "feature/new", strategy: "create"}`
to create a new one at delivery. Editing a queued task accepts
`deliveryBranch: null` to clear the target; omitting it keeps the old value.
The CLI takes `--delivery-branch <name>` together with
`--delivery-branch-strategy <existing|create>` on `aip run start`, `aip queue add`
and `aip queue edit`. To clear a queued task's target, use
`aip queue edit <item> --clear-delivery-branch` instead of the pair.

```sh
aip queue add feature --task "Update profile" --auto-deliver --delivery-mode commit --delivery-branch feature/profile --delivery-branch-strategy existing
aip queue add feature --task "Add profile" --auto-deliver --delivery-mode commit --delivery-branch feature/new --delivery-branch-strategy create
```

For several `--repo` arguments the same name and strategy apply to every project;
each must satisfy the strategy or the entire request is refused. The effective
delivery settings and branch existence are checked again when a queued task starts.

## Safety

Without a target branch, the run's changes are merged with the current content of your working tree, including uncommitted edits, using a three-way merge.

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
- `{number}` is the task number;
- `{pipeline}` is the pipeline name (`{workflow}`, the name used before, means the same);
- `{groups}` is the list of groups with their results.

With `message_specialist`, this specialist writes the message before the commit, from the task number, the task, the group summaries and the list of changed files. If it fails, the template is used.

For a one-line message `feat(AIP-312): updates the docs`:

```yaml
delivery:
  mode: commit
  message_specialist: writer
  commit_message: 'chore(AIP-{number}): {title}'   # used if the specialist fails
  message_prompt: |
    The message is exactly one line, no body and no trailers:
    <type>(AIP-<task number>): <what changed>
    type is a Conventional Commits type: feat, fix, docs, refactor, test, chore.
    The description is short, lowercase, a verb in the third person present
    tense: "updates the docs", "fixes the crash". No final period.
```

`message_prompt` is appended to the task of `message_specialist`, and `resolver_prompt` to the task of the `resolver`.

## Server mode

On a [server](server.md) the clone of the project is not a workplace: its working tree belongs to nobody, so a run delivers a branch and you apply it on your machine.

- `delivery.mode` is `branch`; `worktree` and `commit` are errors in the settings, in a task and in a delivery request. `aip config check` warns that `workspace.base` is ignored.
- Before every run the daemon fetches `remote` and starts the run from `<remote>/<base_branch>`, so it sees what colleagues pushed. `base_branch` defaults to the branch the `HEAD` of `remote` points to. If the fetch fails, the run is not created and the task stays in the queue with the git error.
- `push` (default `true` on a server, `false` locally) sends `aip/<run-id>` to `remote` after the branch is made, with the git credentials of the daemon's OS user. Nothing is forced and no other branch is touched.
- If the branch name is taken by another history, or there is no access, the delivery is `push_failed` with the git reason. The local branch stays, and the run keeps its place in the queue as after `apply_failed`. Fix the cause and press «Retry push» in the panel; only the push is repeated.
- Once sent, `aip run show` and the panel's delivery badge name the remote branch and, for GitHub, GitLab and Bitbucket, link to it.

Give the daemon's OS user a deploy key or a bot account that may create `aip/*` branches, and nothing more: it writes to every project of the server. Protect the main branch on the host so that only a reviewed pull request changes it, and let the host delete merged `aip/*` branches.

### Applying on your machine

With a [server profile](server.md#from-your-machine), in a clone of the project that has a remote with the same address as the server's `remote`:

```sh
aip run apply <run-id>                 # the changes land in the working tree, uncommitted
aip run apply <run-id> --mode commit   # or as one commit with your git identity
aip run apply <run-id> --force         # with conflict markers, like a local delivery
```

The command fetches `aip/<run-id>` and delivers it with the same [safety](#safety) as a local delivery. Groups cannot be named, and a run whose branch is not in the remote repository (`push_failed`) is refused. Only after success the server is told, and the [journal](server.md#audit-journal) records `run.apply` by you; a refusal changes nothing there.

## Cleanup

After all ready groups are delivered, the worktrees and internal refs are removed; logs and history stay. `keep: true` turns the cleanup off, and [`aip run clean`](../usage/runs.md#cleaning-up) removes them by hand.

A failed or cancelled delivery step (`_message`, `_resolve`) is repeated through `aip run apply`.

Commands can also run after delivery, see [Pipeline actions](actions.md). With a failed action after delivery the result stays delivered and the cleanup waits.
