# Pipeline actions

An action is a step that the daemon runs around the steps of a pipeline: a shell command or a step of a specialist. Each action is a file `actions/<id>.yaml` in the `aip/` directory; the id follows the same rules as a pipeline id.

```yaml
# aip/actions/lint.yaml
name: Lint                # optional display name
run: npm run lint         # a shell command; or `specialist: <slug>`
timeout: 300              # seconds a command may run, 1..86400, default 600; only with run
on_failure: stop          # stop | continue
```

Exactly one of `run` and `specialist` is required.

- **`run`** is a command run by the daemon through the shell. No agent is started. It is one script, a string; see [a script of several lines](#a-script-of-several-lines).
- **`specialist`** is a specialist that works as a step of the run. `additional_prompt` is appended to its prompt; it is allowed only with `specialist`.
- **`timeout`** stops a command that works too long; the step fails with the reason `timeout`.
- **`on_failure: stop`** (the default) stops the pipeline at this point; `continue` lets it go on, and the step stays failed.

## A script of several lines

`run` is one script, run by one `sh -c` with the log line `[aip] $ <script>` before it. Write several commands as lines of a block string:

```yaml
# aip/actions/check.yaml
run: |
  set -e
  npm run lint
  npm test
```

The script ends with the code of its last command, and a non-zero code fails the action. Use `set -e` or `&&` to stop at the first failing command. A list in `run` is an error.

## Points

Actions are listed by point in `stages`, in `settings.yaml` for all pipelines or in a pipeline file:

```yaml
# aip/settings.yaml
stages:
  before_delivery: [lint]
  after_delivery: [commit]
```

| Point | Runs | Working directory |
|---|---|---|
| `before_split` | before the split step | the copy of the split; its changes go into the base of the groups |
| `after_split` | after the split, before the groups | the copy of the split; its changes are kept |
| `before_delivery` | after the groups are merged, before delivery | the copy with the merged result; its changes are dropped |
| `after_delivery` | after delivery | your repository |

- The actions of a point run one after another in the listed order.
- `before_split` and `after_split` exist only in a pipeline with `split`.
- A point of a pipeline replaces the same point of `settings.yaml` entirely; an empty list turns the shared actions off.
- Only commands are allowed in `after_delivery`.
- A failed action in `before_delivery` with `on_failure: stop` cancels delivery without changes in your repository; request the delivery again to repeat the check. A failed action in `after_delivery` leaves the result delivered and postpones the cleanup.

## Environment of a command

A command gets `AIP_RUN_ID`, `AIP_RUN_TITLE`, `AIP_PIPELINE`, `AIP_STAGE` (the point), `AIP_ACTION` (the action id) and `AIP_REPOSITORY`. In `after_delivery` it also gets:

- `AIP_DELIVERY_MODE`, the delivery mode;
- `AIP_COMMIT_MESSAGE`, the message of the delivery;
- `AIP_CHANGED_FILES`, the delivered paths, one per line.

For example, to commit what a `worktree` delivery put in your tree:

```yaml
# aip/actions/commit.yaml
name: Commit the result
run: git add -A && git commit -m "$AIP_COMMIT_MESSAGE"
on_failure: continue
```

A command interrupted by a daemon restart fails with the reason `interrupted` and is not started again by itself.

`aip config check` lists the actions with the points that use them, and `aip run show` prints the action steps in the `system` part of a run.
