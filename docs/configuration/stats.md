# Usage statistics

The daemon keeps its own journal of what the agents used: tokens, cost and time. `aip stats` and the web API read a report from it. The journal is independent of the run history: `aip run clean` and removing runs do not touch it.

## `stats`

```yaml
stats:
  enabled: true
  exclude:
    - /work/private-app
  show_cost: true
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Turns collection on. With `false` nothing new is recorded; what was collected stays |
| `exclude` | none | Project paths that are not recorded and not reported |
| `show_cost` | `true` | With `false` every cost in the report is empty; tokens and times stay |

The section is set in the shared `settings.yaml` only. In a project `aip/settings.yaml` it is a validation error (`swarm.stats`). The daemon rereads it within a few seconds, so a change takes effect without a restart. If the section is invalid, collection is off and nothing is excluded until it is fixed.

A path in `exclude` may be any path inside the project: it is reduced to the repository root like a project path. A project in `exclude` is hidden from every report, including the total over all projects; its records stay in the journal.

## What is recorded

- every attempt that ended (`finished`, `failed` or `cancelled`) in any group of a run, with the project, pipeline, step, specialist, runtime, model, times, tokens and cost (`null` when the runtime does not report it, for example `agy`);
- the call that names a run, as a separate record with its tokens and cost;
- every finished run as a task: its full time and its result.

An attempt that is still running is not recorded. A run that finishes again after a retry updates its task record.

An attempt that ended while collection was off, or in an excluded project, is never recorded later: not when collection is turned on again, not when the project is no longer excluded, not after a restart.

## History from before

The first time the daemon sees collection on, it moves the history already in its database into the journal: finished attempts, run naming and finished runs of all projects that are not excluded. This happens once. Turning collection off and on, clearing a project and restarting do not repeat it. If collection is off at the first start, the move waits for the first moment it is on.

## Report

`aip stats` ([usage](../usage/cli.md#panels-and-streams)) and `GET /api/stats` ([HTTP API](../web/http-api.md#statistics)) give the same report:

- totals: tasks, attempts, input and output tokens, cost, agent time, command time and task time;
- mean and median per task for tokens, cost, agent time and task time;
- a row per project and a total over all projects;
- tables by specialist, model, pipeline and runtime;
- a series by local day with zeros for days without data.

Agent time is the time of attempts of every runtime but `command`; command actions are counted as command time. Per-task figures count all records of a task, also those outside the period. An attempt belongs to the period of its end, a task to the period of its finish.

A task that started while collection was off and finished with it on has records of part of its attempts only, so its per-task figures are lower.

## Clearing

`aip stats clear --project <path>` deletes every record of the project and prints how many. Runs and their attempts are not touched, and the history is not moved again.
