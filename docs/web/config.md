# Topology, specialists and pipelines in the web panel

These sections show and edit the [specialists](../configuration/specialists.md) and [pipelines](../configuration/pipelines.md) of the selected repository. Changes apply to new runs; running runs keep their snapshot.

## Topology

The list shows the pipelines of the repository with the number of active runs. The graph shows the steps with specialist, runtime, model and permissions, the split, the merge, the delivery and the resolver.

- Dashed arcs are `on_reject` returns with their round limit.
- The groups of active runs sit at their current step. A click on a group opens it in "Runs".
- A node whose specialist has a limit shows "busy N of M · in other runs: K". It is highlighted when the limit is reached.
- A step node shows "attempts N" and the tokens and cost of the active runs: `in/out · $cost`.

The address `#topology/<pipeline>` opens a pipeline.

## How editing works

Both editors follow these rules:

- Before writing, the daemon checks the resulting configuration. An edit is rejected only if it adds a new error, so a broken configuration can be repaired one file at a time.
- Comments and key order are kept. If the file changed on disk, saving is rejected and the panel offers to reread it.
- An empty field removes the key from the file.
- "Save as…" copies an entry, "Delete" removes it.

## Specialists

The tab edits the `aip/specialists/<slug>.yaml` files of the project and of the shared directory. The form has the [fields of a specialist](../configuration/specialists.md#fields).

- The list shows each specialist with a level badge ("project", "global", "project over global"). "New specialist" creates one.
- The page filters specialists by tags, search text, level, `runtime`, `model`, `skills`, `tools` and `allow_commands`; values are taken after `defaults`.
- Delete is refused with a list of references while steps use the specialist.
- "Override in the project", "Make global" and "Remove the override" move a specialist between the levels. A "Project / Global" switch chooses the level when files exist on both.
- "Import" copies specialists of another repository.

The addresses are `#specialists`, `#specialists/<slug>` and `#specialists/new`.

## Pipeline

The tab edits the `aip/pipelines/<id>.yaml` files of the project. Shared pipelines are edited in [Settings](settings.md#shared-pipelines).

- The "Name" field sets the optional `name` of the pipeline; lists, badges, the graph and the palette show it instead of the id.
- The form lists the steps: id, specialist, the return on rejection with the number of rounds, and the additional prompt. Steps are added, deleted and reordered with buttons.
- The "Task split" switch turns on the split block. Its "Group steps" choice is "Own steps" or the id of another pipeline, which is [`split.pipeline`](../configuration/pipelines.md#groups-that-follow-another-pipelines-steps). When a target is chosen, the step list is hidden and a link to the target's form takes its place.
- The field "Tags" holds the labels of the project file; tags of the shared file are shown as chips with a "Shared" mark.
- "Preview" shows the graph of the draft without writing. While the draft is invalid, the last valid graph stays with a "stale" mark.
- A shared pipeline opens for viewing only. "Override in the project" copies it into the project; "Edit in Settings" leads to `#settings/global/pipelines/<id>`. A new pipeline is always a project one.
- Running runs continue from their snapshot after the pipeline is deleted. A new run of a deleted pipeline is rejected.

The filters are search by id and name, level, "Tags" and "Specialists" (the ones in the steps and in `split`). Any of the chosen values fits inside one list, and all lists together narrow the result. The choice is remembered per repository.

"Import" copies project pipelines of another repository of the panel, with their tags, in one request. A taken id cannot be chosen. The specialists a pipeline names are not copied: if one is missing in the project, nothing is imported and the dialog shows the error.

The addresses are `#pipelines`, `#pipelines/<id>` and `#pipelines/new`.
