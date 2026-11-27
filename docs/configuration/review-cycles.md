# Bounded review cycles

Enable a managed review cycle in a pipeline's `on_reject.review`. New starter
configurations include it. Existing installed files and saved run snapshots are
left as they are: upgrade the code and opt in for future runs when you are ready.
Do not refresh or restart an existing run just to enable the protocol.

For a project that uses `npm run check`, the pipeline file can contain:

```yaml
steps:
  - { id: plan, specialist: planner }
  - { id: code, specialist: coder }
  - id: review
    specialist: reviewer
    on_reject:
      goto: code
      max_rounds: 5
      review:
        stagnant_rounds: 2
        recovery_step: plan
        escalation_specialist: coder-strong
        required_checks: [npm run check]
```

Define `planner`, `coder`, `reviewer` and `coder-strong` as
[specialists](specialists.md). The stronger specialist uses its own permissions,
runtime and model or runtime chain from the run snapshot; the product does not
choose a model vendor for you. Omit `escalation_specialist` to keep the same coder.

| Field | Meaning |
|---|---|
| `stagnant_rounds` | Consecutive revisions without a verified closure of any previous blocking ID; 1–10, default 2 |
| `recovery_step` | Optional planning step earlier than `goto`; without it, stagnation asks a person |
| `escalation_specialist` | Optional existing specialist used at `goto` after recovery; requires `recovery_step` |
| `required_checks` | Up to 50 distinct project gate commands that must be reported passed after the final edit; default empty |

`review: {}` enables the protocol with defaults. Managed reviewers must have
distinct `goto` targets. A variant or explicit skip cannot remove the implementation
or recovery step while retaining its managed reviewer. The pipeline form preserves
the policy on unrelated edits and follows a recovery step's rename; use its source
editor to configure the policy.

## Work and acceptance

The planner divides the full technical scope into sequential slices with acceptance
criteria. The coder works through them within one attempt. A partial slice is a
progress update, not a completed handoff. After a finding, repair the common
invariant across affected paths: for example, preserve presence, type and exact
value on unrelated form edits, and change only the explicitly edited field. Cover
null, missing, blank and wrong-type values in one regression matrix instead of
waiting for separate reviews of each value.

Run targeted regressions while editing. Before handoff, run the project's mandatory
gate after the last change and provide its results. Reviewers inspect those results,
verify closures and investigate regressions from the repair. Repeat broad audits or
full test suites when a new change or concrete unresolved concern warrants it.
Manual acceptance stays with the person.

## Structured reports

The agent receives the role and the current handoff in its input. The same optional
fields are accepted by `swarm_report` and the `report` IPC request:

- Reviewer: `review: { findings, resolved }`. Each open finding has `id`,
  `severity` (`blocker`, `major`, `minor`), `file`, `scenario`, `expected`,
  `evidence`, `origin` (`initial`, `missed`, `regression`) and `reason`.
  A closure is `{ id, evidence }`. Keep the full open list and stable IDs.
  New findings after the first review explain an earlier omission or a regression;
  reopened IDs are regressions. A previous ID cannot silently disappear or become
  nonblocking instead of being closed. Only blocker/major findings reject work.
- Coder: `implementation: { files, resolutions, checks }`. A resolution is
  `{ id, change, tests }` for each open blocking ID. A check is
  `{ command, result: "passed" | "failed", evidence }`. A do-nothing revision with
  blocking findings or a missing/failed required gate cannot report `done`.
- Recovery planner: `strategy: { summary, slices: [{ title, acceptance }] }`.
  Diagnose the failed approach and propose a concrete different one without
  dropping requirements. These are sequential work slices, not new queue tasks.

Lists contain at most 50 items, text fields at most 2000 Unicode characters and IDs
at most 80. Text and evidence cannot be blank; IDs within a list must be unique.
The three report roles are mutually exclusive. A real external blocker can still
be reported through `needs_human` using ordinary feedback/questions without a
structured handoff; a question
cannot replace or erase the open finding ledger. The checks are agent-reported evidence, which
the reviewer must assess; the daemon does not independently execute these commands.

## Changing strategy and stopping

The first rejection establishes the baseline. Two unsuccessful revisions then
trigger one recovery. After recovery the coder receives the revised slices and,
when configured, uses the stronger specialist. Two more stagnant revisions require
a person. Closing a previous blocking ID resets the stagnation streak; adding or
renaming findings does not demonstrate progress. `max_rounds` counts all rejections
and permits that many automatic returns: exceeding it stops before any recovery.

The stop is marked `review_cycle`. The queue autopilot and observers cannot answer,
retry or cancel it to extend the budget, including while an observer repairs another
group. Returning the task to observers does not remove the protection. A person
sees the reason and current findings and may explicitly authorize another attempt,
choose a new approach, or revise the scope. An answer does not reset the counters.

## Context and history

Managed steps receive the latest completed summary of each step, the current open
findings, the latest implementation evidence, the revised strategy and accepted
human decisions. Superseded summaries are not repeated in the next prompt. All
attempts and structured reports remain in the saved history; the attempt panel shows
IDs, origins, closures, checks and acceptance slices. Older runs without the policy
keep their original report contract and input history.
