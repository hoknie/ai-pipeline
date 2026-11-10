# Pipelines

A pipeline is the order of work: which [specialists](specialists.md) act, in which steps, and what happens when one rejects the work. Every pipeline is one file in `aip/pipelines/` (see [File rules](README.md#file-rules)). The web panel calls a pipeline a "Pipeline"; in the files and in the CLI it stays a pipeline.

The file `aip/pipelines/feature.yaml` (the id `feature` is the file name):

```yaml
name: New feature                            # optional display name
tags: [backend, release]                     # labels for the panel; do not affect runs
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
    human_review: true
```

## Pipeline fields

- **`name`** is the display name. The panel shows it instead of the id (the id stays in the tooltip), and `aip run list`, `aip run show` and the queue print `<name> (<id>)`. Without it the id is shown. Surrounding spaces are dropped, and an empty name is an error. Arguments such as `aip run start <pipeline>` always take the id.
- **`tags`** are labels for the filter and the import on the panel's [Pipeline](../web/config.md#pipeline) page. They do not change the steps, the run or its snapshot.
  - A name is trimmed, 1 to 30 characters, without a line break; repeats that differ only in case are merged. A value that is not a list of such names is an error at `swarm.pipelines.<id>.tags`.
  - The tags of the shared file and of the project file are kept apart, and a project file over a shared one shows both.
- **`steps`** is the list of steps, see below.
- **`stages`** lists the [actions](actions.md) by point; a point set here replaces the shared one.
- **`split`** divides a task into groups, see [Split](#split).

## Step fields

The steps of a group go strictly in order. Groups of one run work in parallel, within [`max`](README.md#max).

| Field | Meaning |
|---|---|
| `id` | The step id, used in `--skip`, `goto` and commands |
| `specialist` | Who does the step |
| `on_reject` | Where a rejection returns: `goto` and `max_rounds`, see [Returns](#returns) |
| `additional_prompt` | Extra instructions for this step |
| `human_review` | Stop for a person after the step, see [Human review](#human-review) |

`additional_prompt` on a step (and on `split` for the split specialist) is appended as a separate paragraph after the specialist's prompt with the task filled in, and before the `aip` service instructions. One specialist can behave differently in different steps: a reviewer checks only the tests in one of them.

- The text is taken as is: `%s` and `%%` are not substituted in it.
- State any narrowing explicitly, because the step's text comes after the specialist's prompt.

## Verdicts

Every specialist ends a step by calling [`swarm_report`](../hosts/mcp-tools.md#tools-of-a-specialist) with a verdict:

- `done` moves on to the next step;
- `rejected` goes back to the `goto` step together with the remarks;
- `needs_human` stops with a question, as text in `feedback` or as a list in `questions`.

A step that ends without `swarm_report`, or on `timeout`, gets the `failed` status; [retry it](../usage/runs.md#retrying) with `aip group retry`.

## Returns

`on_reject.goto` must point to an earlier step. After `max_rounds` returns the group goes to `needs_human` with the last feedback. Your answer goes to the `goto` step together with that feedback, as one more round; a further rejection asks you again. A `rejected` verdict on a step without `on_reject` also leads to `needs_human`.

## Asking a person

### Questions

`questions` in `swarm_report` (only with `needs_human`) holds 1 to 10 independent questions in one report.

- A question has a `text` (up to 2000 characters), optional `options` (1 to 6 choices of up to 200 characters each) and a `recommendation` (up to 2000 characters), the recommended answer.
- If `feedback` is empty, it is filled with the numbered text of the questions, so `aip run list`, `aip group show` and `aip group answer` show it as text.
- The human's answer reaches the specialist as one text: `Q1: …` / `A1: …` for each question.

Answer with [`aip group answer`](../usage/runs.md#answering-a-specialist), in the [panel](../web/runs.md#questions) or in the [Claude Code panel](../hosts/claude-code.md#what-the-panel-shows).

### Human review

`human_review: true` on a step stops the group for a review by a person after the step reports `done`.

- The changes of the step are committed first, so the person sees them in the diff. The group goes to `needs_human` with a question that carries the summary of the step, marked `human review`.
- The answer of the person resumes the same step. If the specialist reports `done` again, the group goes on without a second review; `rejected` and `needs_human` work as usual.
- The [queue's auto answer](../usage/queue.md#answering-questions) never answers such a question.

### Human only

`human_only: true` in `swarm_report` (only with `needs_human`) asks for a person's own look, for example at the architecture of what was written. The question is marked `human only`, and the queue's auto answer does not answer it.

## Split

`split` divides a task into groups, each with its own worktree.

- A run created from a single text (`--task`) starts with `split.specialist`. It proposes from 1 to `max_groups` groups with the `swarm_split` tool, and each group goes through all the steps.
- If the groups are passed as a list (`--groups`), the split is skipped.
- In commands the split step is the `_split` group.
- After the split each group starts at the first step of its own pipeline, or, with `split.pipeline`, at the first step of the named pipeline.

### Groups that follow another pipeline's steps

The `split.pipeline` field names the pipeline whose steps the groups follow after the split. The groups of this epic go through the steps of the `explore` pipeline:

```yaml
# aip/pipelines/epic.yaml
split:
  specialist: plan
  pipeline: explore
```

- Such a pipeline has no steps of its own: `steps` and `split.pipeline` are mutually exclusive.
- A pipeline cannot target itself, and the target cannot have a `split.pipeline` of its own.
- A pipeline that `split.pipeline` refers to cannot be deleted.
- Changing `explore` after a run has started does not affect that run, because the steps come from the configuration snapshot.

## Skipping steps of one task

`--skip <step>` makes one task skip steps without editing the pipeline: see [Skipping steps](../usage/queue.md#skipping-steps). `aip run skip` skips a step of a run that has started: see [Skipping a step](../usage/runs.md#skipping-a-step).

## Old names

Before the term was unified, pipelines were called workflows. Files and runs made then keep working:

- the directory `aip/workflows/` is read together with `aip/pipelines/`; an id in both is an error. The web panel edits and deletes a file where it lies, and creates new files in `aip/pipelines/`;
- the key `split.workflow` is read as `split.pipeline`; both keys in one file are an error;
- `{workflow}` in `delivery.commit_message` is read as `{pipeline}`;
- `aip queue edit --workflow` and `-w` are read as `--pipeline` and `-p`; the old names are no longer in `--help`;
- `#workflows…` addresses of the web panel open the pipeline pages;
- the environment variable `AIP_WORKFLOW` of command actions is still set, with the same value as `AIP_PIPELINE`;
- runs and queued tasks of an earlier version open as they were.

`aip config check` lists the files with old names. To move them:

```sh
git mv aip/workflows aip/pipelines
```

and rename `split.workflow` to `split.pipeline` in them.

These names are **not** accepted anymore, and a client has to change them:

- the argument `workflow` of the MCP tools `swarm_run`, `swarm_queue_add` and `swarm_queue_edit` is now `pipeline` (see [mcp-tools.md](../hosts/mcp-tools.md)); install the new Claude Code [plugin](../hosts/claude-code.md) together with the package;
- the fields `workflow` and `workflowName` in `--json` and `aip events --json` are now `pipeline` and `pipelineName`;
- the HTTP API addresses `/api/workflows`, `/api/shared-workflows` and `/api/config/workflows/…` are now `/api/pipelines`, `/api/shared-pipelines` and `/api/config/pipelines/…` (see [web/http-api.md](../web/http-api.md)).

After the first start of a new version the state database cannot be opened by an older version. Keep a backup of the state directory before updating if you may roll back.
