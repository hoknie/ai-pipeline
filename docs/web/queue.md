# Queue in the web panel

The "Queue" section adds, orders and runs tasks. How the queue behaves is described in [usage/queue.md](../usage/queue.md); this page covers where things are in the panel.

## Layout

- The "Queue controls" block on the left holds the state, the buttons "New task", "Start" and "Pause", the parallelism and the link "Queue settings".
- Below the controls are the running runs and the waiting tasks. A running run's card shows its duration and tokens.
- Runs the queue skipped because of a problem are in the "Skipped with a problem" block. They do not count as taken places.

## Task rows

Drag a task by its handle to reorder it, or use `Alt+↑` / `Alt+↓`. The row actions are:

- "Edit" (while the form is open it is "Cancel");
- ["Postpone"](../usage/queue.md#postponed-tasks): it stays pressed while the task is postponed, and pressing it again puts the task back;
- "Remove";
- "Run now" ("Continue" on a paused or frozen task). Its tooltip carries the warning about [freezing](../usage/queue.md#freezing).

"Run now" on a task that is not ready asks to confirm "Dependencies are not met" and lists them.

A task with links shows them on a second line, grouped by kind; see [Links](#links). Only the "Blocked by" links affect readiness and the "Dependencies are not met" confirmation. A chip of another project carries the project name and opens that project's queue.

## Runs out of line

- "Return to the queue" is on a skipped run only when it has failed or cancelled groups to retry. It is also in the header of any run with failed or cancelled groups that is not in its queue. The run becomes the first task, marked "Return" with a link to the run.
  Only its place and its "Blocked by" links can be changed; the other links are shown locked, with an "Edit on the run page" link (the "Links" tab). See [Returning a run](../usage/queue.md#returning-a-run).
- "Remove from list" is on every skipped run. After a confirmation the card disappears; the run itself does not change.

## The task form

"New task" opens a dialog with two halves: the task on the left and its settings on the right.

- **"Repository"** defaults to the repository selected in the top bar. Choosing another one adds the task to its queue and does not switch the panel. The pipelines, the link choices and the delivery defaults come from that repository; the links are cleared on a switch, the text and tags stay.
- **Title, pipeline, text or groups** describe the task.
- **"Links"** holds one row per [link](../usage/queue.md#task-links): a kind and a task picked by number or title; "Add link" adds a row, and the × on a row removes it.
- **"Postpone"** adds the task [postponed](../usage/queue.md#postponed-tasks). The switch is only in the new task; for an existing task the "Postpone" button in the list changes the flag.
- **"Attachments"** has an "Attach files" button and a drop zone. Each file is uploaded at once, with its progress shown. A file over 20 MB, an eleventh file and a repeated name are refused with a message and stay out of the list; a failed upload shows its error and is not sent with the task. "Add" is unavailable while a file is uploading.
- **Tags** and **delivery** are the [tags](../usage/tags.md) and [delivery settings](../configuration/delivery.md#settings-for-one-task) of the task.
- **"Variant"** chooses a [variant of the pipeline](../usage/queue.md#variants); it is shown only when the pipeline has variants, and changing the pipeline resets it to `default`. The queue and the cards of runs show a badge with the variant name next to the pipeline badge, except for `default`.
- **"Skip steps"** is a row of segments: a pressed segment is a [skipped step](../usage/queue.md#skipping-steps), and the last unpressed one stays disabled. Steps skipped by the chosen variant are pressed and cannot be changed.

**"Add and continue"**, next to "Add" in the new task dialog, adds the task and keeps the form open: the title, the text, the groups and every link row except "Parent" are cleared, the other settings stay, and the focus returns to the text. The form of an existing task has no such button.

### Links

The [links](../usage/queue.md#task-links) of a task are edited in the "Links" block of the task form; the links of a run — in the "Links" section of its page.

- The block of the form shows only the direct links. The section of the run page and the row in the queue also show the inverse sides: "Blocks", "Subtasks" and "Duplicated by".
- The run page shows a collapsible "Links" section under the status line, separated by a rule, only when the run has links. It has two blocks, "Outgoing" and "Incoming". The chips link to the run page or to the project's queue; a chip of the "Blocked by" group carries a state icon, and the × on a direct chip removes the link.
- The "Links" tab among the tabs of the run page is always there, even without links. Rows are added, changed and removed there like in the task form; "Save" applies all changes at once (removals first), "Reset" drops them. An error of the daemon stays under the rows and the edits are kept.
  The "Add link…" item of the "More" menu opens a small dialog with a kind and a task; the "Blocked by" kind is not offered there.
- In the queue, a row's second line holds the chips: the direct groups "Blocked by:", "Parent:", "Related:" and "Duplicates:", then the inverse groups "Blocks:", "Subtasks:" and "Duplicated by:".
  A "Blocked by" chip shows the state of the target (done, waiting, blocked) as an icon. More than three subtasks collapse into "More N" with the full list in the tooltip. A task without links has no second line.
- Hovering over or focusing a row highlights it together with everything reachable over its "Blocked by" and "Parent" links in both directions, including the run cards; "Related" and "Duplicates" never highlight. The branch line on the left still follows the "Blocked by" chains.

### One task in several projects

The button **"In several projects"** in the header of the new task dialog and of the new task page switches the form to another view; the title becomes "New task in several projects".

The left half holds what is shared: name, pipeline and variant, text and the shared tag.

- "Add" is available with two or more projects and sends one request, so every project gets its task or none does.
- "Variant" and the pipeline list offer only pipelines that every selected project has; without any, the form says so and does not add.
- Under the text there is an optional **"Addition for <project>"** field per project; it is appended to the shared text of that project.
- **"Shared tag"** is filled from the title (up to 30 characters, cut at the last whole word); an empty field means no tag. See [shared tag](../usage/tags.md#shared-tag-of-a-task-in-several-projects).
- **"In turn"** makes the task of each project wait for the previous one; off by default.
- Groups, attachments and the project tags field are not shown. An error of the daemon names the project and the entered data stays. See [one task in several projects](../usage/queue.md#one-task-in-several-projects).

### The text editor

The text of a task and of each group has a toolbar. Its first element is the display switch `Plain` / `MD`; `Plain` is the default at every opening.

- `MD` enables the markup buttons: heading, bold, italic, strikethrough, bulleted, numbered and task lists, quote, code, code block and link. A button wraps the selection (or the lines it touches) in the markup, and pressing it again takes the markup off.
- "Preview" shows the text as Markdown.
- The display does not change the text, and pasted formatted text becomes Markdown in both modes.
- In a form of a task that already runs, the switch and "Preview" work while the text and the markup buttons are unavailable.

## Global queue

With the [global queue mode](../usage/queue.md#global-queue) the section "Queue" shows one queue of all projects instead of the queue of the selected project.

- The badge "Global queue" and the limit "At most N specialists" (`queue.max`) are on top.
- Every task and every run carries the label of its project. Waiting tasks stand in the global order; drag a task by its handle (or `Alt+↑` / `Alt+↓`) to a place among the tasks of all projects.
- The take filter selects projects, pipelines and tag names across projects; it changes only while the queue is stopped. A task matches the tag filter when it has at least one selected name. Tasks of a disabled project are not taken.
- With no projects selected, pipeline and tag choices come from all enabled projects; selecting projects limits both lists to those projects.
- "Start", "Pause", the parallelism and the reason for stopping are those of the global queue.
- The counter of the section "Queue" counts the waiting tasks of all projects.

## Queue modes

The modes of the queue are in the group "Queue" of the [project settings](settings.md#project-groups) (`#settings/project/queue`). They switch at once, without "Save".

- The switches "Keep running when empty", "Answer questions" and "Skip failed", the answer text and the "On a usage limit" selector are the [queue settings](../usage/queue.md#queue-settings).
- "Auto delivery" and "Delivery mode" write `delivery.auto` and `delivery.mode` to the file the value comes from: the project `aip/settings.yaml` if the field is set there, otherwise the shared `settings.yaml`. The file is shown under the control.

A queue stopped by a [usage limit](../usage/queue.md#usage-limit) shows which agent ran out, when the limit resets and, with `wait`, when the queue resumes by itself. "Pause" cancels the automatic start. A group waiting for the reset shows "Limit until HH:MM".

## All projects

With "All projects" chosen in the repository picker, the section shows the queue of every enabled project, ordered by name.

- Each project is a block: name, state, parallelism, "Start", "Pause" and "Open the project queue", which leaves the mode and selects the project.
- Inside a block are the reason to stop, "Running from the queue" and the waiting tasks, with the actions of the project page. Every action goes to the queue of its own project, and a task can be dragged only inside its block.
- "New task", "Start all" and "Pause all" stand above the blocks. "Start all" starts each stopped queue with a waiting task that is not postponed. "Pause all" pauses each queue that is running or waits for a usage limit to reset. A button is disabled when it has nothing to change.
- Each queue gets its own request. A refusal of one does not cancel the others, and the notice names the project and the reason.
- Projects with nothing to show (no tasks, no runs, no reason to stop, stopped) collapse into the line "Empty queues: …"; a name in it opens the block.
- Autopilot, answers, skipping of failed tasks, the limit behaviour and the take filter stay on the page of the project.
- The "New task" dialog starts on the last project you chose.
