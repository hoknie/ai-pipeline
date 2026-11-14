# Queue in the web panel

The "Queue" section adds, orders and runs tasks. How the queue behaves is described in [usage/queue.md](../usage/queue.md); this page covers where things are in the panel.

## Layout

- The "Queue controls" block on the left holds the state, the buttons "New task", "Start" and "Pause", the parallelism and the link "Queue settings".
- Below the controls are the running runs and the waiting tasks. A running run's card shows its duration, tokens and cost.
- Runs the queue skipped because of a problem are in the "Skipped with a problem" block. They do not count as taken places.

## Task rows

Drag a task by its handle to reorder it, or use `Alt+↑` / `Alt+↓`. The row actions are:

- "Edit" (while the form is open it is "Cancel");
- ["Postpone"](../usage/queue.md#postponed-tasks): it stays pressed while the task is postponed, and pressing it again puts the task back;
- "Remove";
- "Run now" ("Continue" on a paused or frozen task). Its tooltip carries the warning about [freezing](../usage/queue.md#freezing).

"Run now" on a task that is not ready asks to confirm "Dependencies are not met" and lists them.

A task with predecessors shows them on a second line after "Waits for:".

## Runs out of line

- "Return to the queue" is on a skipped run only when it has failed or cancelled groups to retry. It is also in the header of any run with failed or cancelled groups that is not in its queue. The run becomes the first task, marked "Return" with a link to the run. Only its place and predecessors can be changed. See [Returning a run](../usage/queue.md#returning-a-run).
- "Remove from list" is on every skipped run. After a confirmation the card disappears; the run itself does not change.

## The task form

"New task" opens a dialog with two halves: the task on the left and its settings on the right.

- **"Repository"** defaults to the repository selected in the top bar. Choosing another one adds the task to its queue and does not switch the panel. The pipelines, "Waits for", the parent task and the delivery defaults come from that repository; the links are cleared on a switch, the text and tags stay.
- **Title, pipeline, text or groups** describe the task.
- In task mode, either the title or the description is enough. If the description is empty, the title is sent as the task text.
- In groups mode, each group needs a title, a description or both; an entirely empty group is not allowed. For example, a group with only the description `Fix login\nCheck errors` gets the title `Fix login` and keeps the full description. When editing a saved task, these canonical values appear in their fields.
- **"Waits for"** chooses the [predecessors](../usage/queue.md#dependencies). A row shows the state of each predecessor and a readiness badge (ready, waiting, blocked).
- **"Parent task"** chooses one run of the repository as the [parent](../usage/tags.md#parent-of-a-task), finished runs included, in three parts: "In progress", "Planned" and "Finished". The chosen parent is shown as `#N title`. "No parent task" removes the linked task tags of the task.
- **"Postpone"** adds the task [postponed](../usage/queue.md#postponed-tasks). The switch is only in the new task; for an existing task the "Postpone" button in the list changes the flag.
- **"Attachments"** has an "Attach files" button and a drop zone. Each file is uploaded at once, with its progress shown. A file over 20 MB, an eleventh file and a repeated name are refused with a message and stay out of the list; a failed upload shows its error and is not sent with the task. "Add" is unavailable while a file is uploading.
  The files stay in the draft until the task is added. In the form of a waiting task its files can be removed and new ones attached; the files of a returned run are only shown. A row with files shows a paperclip with their number. See [attachments](../usage/queue.md#attachments).
- **Tags** and **delivery** are the [tags](../usage/tags.md) and [delivery settings](../configuration/delivery.md#settings-for-one-task) of the task.
- **"Variant"** chooses a [variant of the pipeline](../usage/queue.md#variants); it is shown only when the pipeline has variants, and changing the pipeline resets it to `default`. The queue and the cards of runs show a badge with the variant name next to the pipeline badge, except for `default`.
- **"Skip steps"** is a row of segments: a pressed segment is a [skipped step](../usage/queue.md#skipping-steps), and the last unpressed one stays disabled. Steps skipped by the chosen variant are pressed and cannot be changed.

**"Add and continue"**, next to "Add" in the new task dialog, adds the task and keeps the form open: the title, the text, the groups and "Waits for" are cleared, the other settings stay, and the focus returns to the text. The form of an existing task has no such button.

### The text editor

The text of a task and of each group has a toolbar. Its first element is the display switch `Plain` / `MD`; `Plain` is the default at every opening.

- `MD` enables the markup buttons: heading, bold, italic, strikethrough, bulleted, numbered and task lists, quote, code, code block and link. A button wraps the selection (or the lines it touches) in the markup, and pressing it again takes the markup off.
- "Preview" shows the text as Markdown.
- The display does not change the text, and pasted formatted text becomes Markdown in both modes.
- In a form of a task that already runs, the switch and "Preview" work while the text and the markup buttons are unavailable.

## Queue modes

The modes of the queue are in the group "Queue" of the [project settings](settings.md#project-groups) (`#settings/project/queue`). They switch at once, without "Save".

- The switches "Keep running when empty", "Answer questions" and "Skip failed", the answer text and the "On a usage limit" selector are the [queue settings](../usage/queue.md#queue-settings).
- "Auto delivery" and "Delivery mode" write `delivery.auto` and `delivery.mode` to the file the value comes from: the project `aip/settings.yaml` if the field is set there, otherwise the shared `settings.yaml`. The file is shown under the control.

A queue stopped by a [usage limit](../usage/queue.md#usage-limit) shows which agent ran out, when the limit resets and, with `wait`, when the queue resumes by itself. "Pause" cancels the automatic start. A group waiting for the reset shows "Limit until HH:MM".
