# Runs in the web panel

The "Runs" section shows every run and lets you act on it. What runs and groups are is described in [usage/runs.md](../usage/runs.md); this page covers where things are in the panel.

Addresses can be shared: `#runs/<run-id>` opens a run, `#runs/<run-id>/<group>` a group, and `#runs/<run-id>/<group>?tab=<tab>` a tab (`changes`, `task`, `design`, `tasks`, `artifacts`). The log is the default tab and is not written to the address.

## The run list

- Filters: a search (title, name, task number `#N`, pipeline, specialists, groups, tags), the switch "This repository" / "All repositories", and multiselects "State", "Pipeline", "Specialists", "Tags" and, for all repositories, "Repository".
- A run card shows the first line of the task, the status, the name of its pipeline (the id is in the tooltip), time, cost and a summary of changes (`2 files +367 −0`).
- The state "Repair" is shown by a badge in the list, in the header and in the statuses, and can be chosen in the "State" filter. A run in "Repair" counts as working in the navigation, and its question, failure, conflict and refused delivery raise no notifications while the observer works on it.
- A finished run with group warnings has a yellow "Warnings: N" badge.
- A stopped run (finished, failed or cancelled) whose merged result is not delivered to the working tree has a yellow "Not delivered" badge, and its card is tinted with a soft warning colour. The tooltip tells how many groups are delivered.
- A failed delivery shows "Delivery failed N" with the reason in the tooltip, in any run state. The mark is absent while a delivery goes on and once everything is delivered, also by hand.

## A run

- The first row of the header summary, "Status", holds the state of the run, its delivery and the status of the open group or step.
- The title is edited in place: Enter or leaving the field saves, Escape cancels.
- The action row has "Deliver", "Return to the queue" and "Steps".
- The "More" menu has "Retry failed (N)" ("Retry failed and cancelled (N)") and "Retry with current config (N)" when the run has failed or cancelled groups, then "Create subtask…", "Deliver with --force…" and "Copy run id".
- "Create subtask…" opens the [task form](queue.md#the-task-form) on the repository of the run with that run as the "Parent task". The text already typed in the dialog is kept.
- ["Retry with current config"](../usage/runs.md#retry-with-the-current-configuration) is also next to "Retry" in the "⋯" menu of a failed or cancelled group or split step. Commit message and resolver steps do not have it.

### The observer

- While a run is in "Repair", the header has the button "Cancel the observer". It forbids the observer in this run, and the header then shows a mark of the ban and the button "Give back to the observer", which allows it again. The error of a refused request is shown next to the button.
- If the observer cancelled the whole task, the header shows the reason it gave.
- The work of the observer is the service group "Observer" of the run, with the journal of its attempts and the answers of the agent.
- An answer given by the observer is marked "observer" in the run list, in the group and in the attempt.

### Steps

The "Steps" block lists each step of the pipeline with its state (done, running, upcoming) and a "Skip" switch for steps that are not finished yet.

- Skipping a running step asks for confirmation: the specialist is stopped without a commit, and its partial changes stay uncommitted in the group worktree.
- Turning the switch off brings the step back.
- Steps skipped when the run was created are not shown.

## A group

- The header has the step, round, time, changes, "Retry step", "Skip step" and "Cancel group".
- "Skip step" is shown for the step the group stands on, unless that step is skipped or finished. It skips the step for the whole run. The panel asks for confirmation when an attempt is running on the step or the run has more than one group.
- Above the tabs are the question to a human, warnings and [files changed outside the worktree](../configuration/README.md#outside_changes).

The tabs:

- **"Log"** shows the attempts of the group: specialist, runtime, verdict, tokens and cost. Consecutive fragments of one answer grow in a single block, timestamped with the first fragment's time. The log of a running attempt keeps loading by itself; the raw-log view retains the original events.
- **"Changes"** is a file tree with `+N −M`.
- **"Task"** shows the task text.
- **"Artifacts · N"** lists the [artifacts](../usage/runs.md#artifacts) of the group, newest first, with the step, title, file name, time and size. "Open" previews `.md` and `.log` files up to 1 MB, and "Download" saves any file. While the group has no artifacts the tab is dimmed, and `?tab=artifacts` falls back to the log.

### Message to the specialist

"Message to the specialist" sits on the right of the header of the last attempt, while it runs and has not reported. It interrupts the specialist: the attempt is stopped ("interrupted by a message") and the step continues in the same session as a new attempt that receives your text.

While the attempt is stopping, the header shows "interrupting…". Files changed before the interruption stay in the working copy. Cancelling the group at that moment drops the message.

## Questions

A specialist can ask [structured questions](../configuration/pipelines.md#questions). They appear as the "Specialist questions · N" form above the tabs.

- A question shows its options as buttons. The recommended option has a "recommended" badge.
- The answer field is filled with the recommendation. "Answer" is unavailable while a field is empty.
- Drafts are kept until the answer is sent.
