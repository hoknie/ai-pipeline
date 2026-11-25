# Contrast probes

A probe repeats the task of a run on the base commit that run started from, with one variant of the
pipeline, and compares the variants by objective signals only. It answers one question: does this
variant of the harness deliver better on this task? The harness here is everything the pipeline
variant changes: prompts, skills, tool guidance, models and skipped steps.

Probes spend tokens, so an experiment has an explicit budget. They never apply anything: a winner is
a proposal for a person.

## Starting an experiment

```sh
aip run contrast <run-id> --candidate default --candidate strong
```

| Option | Meaning |
|---|---|
| `--group <slug>` | The work group whose task is probed; the first group by default |
| `--candidate <variant>` | A variant of the pipeline; repeat for each variant, the first is the baseline |
| `--repetitions <n>` | Paired runs per candidate; at least 6, because the sign test needs 6 decided pairs |
| `--max-runs <n>` | The hard limit of runs; a plan above it is refused before any run starts |
| `--max-tokens <n>` | The soft limit of tokens, checked before the next repetition |

Every candidate must be a `variants` entry of the pipeline. `--max-runs` defaults to candidates ×
repetitions.

The command creates one run per candidate and repetition. A probe run:

- starts from the base commit of the source run, not from the current head;
- keeps the task, the group title, the provider, the attachments and the step skips of the source
  run; the variant is the candidate, so it is the only part of the harness the probes change;
- is not a queue item and never delivers on its own;
- works in its own worktree under `.aip/worktrees` and keeps its commits in hidden refs
  `refs/aip/<run>/…`. The user's worktree and branches stay untouched.

## Reading the comparison

```sh
aip run contrast-show pr0mh3k2ab1x9z
aip run contrast-show pr0mh3k2ab1x9z --json
```

The output lists, for every candidate:

| Signal | Meaning |
|---|---|
| `clean` | Runs whose every group merged and whose result applies cleanly on the base commit |
| `conflicts` | Files of the merged result that conflict when applied on the base commit |
| `denials` | Tool calls the runtime refused |
| `outside changes` | Files an attempt changed outside its worktree |
| `check errors` | Probes whose isolated check could not run; they decide no pair |
| `tokens` | Tokens every attempt of the probes used |
| verdicts | `done`, `rejected` and `needs_human` reports, counted but not judged |

The check runs in a temporary git index, so it never touches the worktree. A git failure is a check
error, not a conflict: the probe says nothing about the harness and is left out of the pairs.

Candidates are compared repetition by repetition with the baseline, one bit per pair: a clean probe
against an unclean one is a win or a loss, two equal outcomes are a tie. The exact two-sided sign
test trusts a difference only with at least 6 decided pairs and a p-value below 0.05. The result is
one of:

| Status | Meaning |
|---|---|
| `running` | Some probes have not finished |
| `ready` | The comparison is complete; `winner` names the variant to consider, or stays empty |
| `budget_exhausted` | The token limit was reached; there is no winner |
| `failed` | A probe did not start; the experiment is visible with the runs it created |

## The budget

`max-runs` is the hard stop: the plan is checked against it before any run starts, and a plan above
it is refused. `max-tokens` is checked before each next repetition: the repetitions of one round
run together, and only after every probe of that round settled does the next round start. Once the
tokens of the created probes reach the limit, no further probe is created. The probes that exist
keep running and are not cancelled, so the experiment may finish above the limit; in that case it
reports `budget_exhausted` and names no winner.

## The proposal

Only a significant winner gets a Markdown proposal: `contrast-show` writes it near the daemon state,
under `probes/`, and prints its path. An inconclusive experiment writes no file and prints
`no winner`. The proposal names the variant to use, the objective signal behind the choice and the
budget the experiment spent. Probes never change the configuration: a person applies the variant to
`aip/pipelines/<pipeline>.yaml` by hand.

`run_contrast` also accepts fewer than 6 repetitions; the answer then carries a warning, because a
difference of fewer decided pairs cannot be significant. The CLI refuses such a request instead.
