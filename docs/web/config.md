# Topology, specialists and pipelines in the web panel

These sections show and edit the [specialists](../configuration/specialists.md) and [pipelines](../configuration/pipelines.md) of the selected repository. Changes apply to new runs; running runs keep their snapshot.

## Topology

The list shows the pipelines of the repository with the number of active runs. The graph shows the steps with specialist, runtime, model and permissions, the split, the merge, the delivery and the resolver.

- Dashed arcs are `on_reject` returns with their round limit.
- The groups of active runs sit at their current step. A click on a group opens it in "Runs".
- A node whose specialist has a limit shows "busy N of M · in other runs: K". It is highlighted when the limit is reached.
- A step node shows "attempts N" and the tokens and cost of the active runs: `in/out · $cost`.

## How editing works

Both editors follow these rules:

- Before writing, the daemon checks the resulting configuration. An edit is rejected only if it adds a new error, so a broken configuration can be repaired one file at a time.
- Comments and key order are kept. If the file changed on disk, saving is rejected and the panel offers to reread it.
- An empty field removes the key from the file.
- "Save as…" copies an entry, "Delete" removes it.

## Specialists

The page has two tabs: "Specialists" and "Chains".

The "Specialists" tab edits the `aip/specialists/<slug>.yaml` files of the project and of the shared directory. The form has the [fields of a specialist](../configuration/specialists.md#fields).

- The list shows each specialist with a level badge ("project", "global", "project over global"). "New specialist" creates one.
- Specialists can bind to an execution chain via the "Runtime chain" selector. When a chain is selected, individual runtime and model fields are hidden.
- The runtime selector includes Claude Code, OpenCode and Antigravity CLI (`agy`). The tools and skills picker follows the selected runtime.
- The page filters specialists by tags, search text, level, `runtime`, `model`, `skills`, `tools` and `allow_commands`; values are taken after `defaults`.
- Delete is refused with a list of references while steps use the specialist.
- "Override in the project", "Make global" and "Remove the override" move a specialist between the levels. A "Project / Global" switch chooses the level when files exist on both.
- "Import" copies specialists of another repository.

The addresses are `#specialists`, `#specialists/<slug>` and `#specialists/new`.

### Chains

The "Chains" tab edits project runtime chains (`aip/chains/<slug>.yaml`) for failover and multi-model execution. New chains on this tab are always saved to the project.

- Mode: `on_error` (failover on limits or unavailable runtime), `round_robin` (turn-based iteration), or `random`.
- Ordered list of runtimes with individual model, variant, reasoning effort, and enable toggles.
- Shared chains are view-only here. "Override in the project" copies a shared chain into the project; "Remove the override" returns to the shared chain.
- Shared chains (`~/.config/aip/chains/<slug>.yaml`) are created and edited in [Settings](settings.md) under the "Chains" group (`#settings/global/chains`). This form edits the shared source even when the current project overrides it.

The addresses are `#specialists/chains`, `#specialists/chains/<slug>` and `#specialists/chains/new`.

## Pipeline

The page has three tabs: "Pipeline", "Actions" and "System stages". Each tab shows only its own list; the filters belong to the "Pipeline" tab. Choosing a tab opens the entry that was last open on it, or the default one: the first action (the form of a new action when there are none) and the first system stage.

The "Pipeline" tab edits the `aip/pipelines/<id>.yaml` files of the project. Shared pipelines are edited in [Settings](settings.md#shared-pipelines).

- The "Name" field sets the optional `name` of the pipeline; lists, badges, the graph and the palette show it instead of the id.
- The form lists the steps: id, specialist, the return on rejection with the number of rounds, and the additional prompt. Steps are added, deleted and reordered with buttons. Deleting a step also clears the return of every step that pointed to it, with its number of rounds.
- The "Task split" switch turns on the split block. Its "Group steps" choice is "Own steps" or the id of another pipeline, which is [`split.pipeline`](../configuration/pipelines.md#groups-that-follow-another-pipelines-steps). When a target is chosen, the step list is hidden and a link to the target's form takes its place.
- The field "Tags" holds the labels of the project file; tags of the shared file are shown as chips with a "Shared" mark.
- "Diagram" is a visual editor of the same draft, in the manner of the visual editors of issue trackers. It shows all the stages that "Topology" does, with sections, performers and conditions; a click on a system stage (merge, delivery, commit message, resolver, cleanup) opens its description.
- The block "Actions at the points of the pipeline" lists the actions that run at each point. A point without a list of its own shows the inherited one with an "inherited" mark; an empty list turns the point off.
- A shared pipeline opens for viewing only. "Override in the project" copies it into the project; "Edit in Settings" leads to `#settings/global/pipelines/<id>`. A new pipeline is always a project one.
- Running runs continue from their snapshot after the pipeline is deleted. A new run of a deleted pipeline is rejected.

The "Actions" tab edits one action. A sticky header shows its name, the level, the file and the buttons "Save", "Discard changes" (after an edit) and "Delete".

Below, the card "Main" holds the id of a new action, the name, the type and "On failure"; next to it (two columns on a wide window, one on a narrow one) is the card "Command" with a single script field that grows with the text, and the timeout, or the card "Specialist".

The script is one text: several commands are its lines.

The filters are search by id and name, level, "Tags" and "Specialists" (the ones in the steps and in `split`). Any of the chosen values fits inside one list, and all lists together narrow the result. The choice is remembered per repository.

"Import" copies project pipelines of another repository of the panel, with their tags, in one request. A taken id cannot be chosen. The specialists a pipeline names are not copied: if one is missing in the project, nothing is imported and the dialog shows the error.

### System stages

A system stage (task split, commit message, delivery conflict resolution, delivery) shows its built-in task read only. Under it the stage settings have two tabs, "Shared" and "Project", as on the [Settings](settings.md) page. The line above the form names the file the tab saves to.

Each field shows the value of its tab and where it comes from; on the "Project" tab "Inherit" removes the project key.

The commit message stage has the specialist, the commit message template and the additional prompt. The template and the additional prompts are text areas, so line breaks are kept; a value of only spaces removes the key. "Save" writes all changes of the tab in one request. The split has no settings of its own: it is set in the pipeline.

The addresses are `#pipelines`, `#pipelines/<id>` and `#pipelines/new`; `#pipelines/actions/<id>` and `#pipelines/system/<kind>` open the other tabs. `#pipelines/system/<kind>/global` opens the "Shared" tab of a stage; without the suffix the "Project" tab opens.
