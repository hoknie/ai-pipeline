# Runs in the web panel

The "Runs" section shows every run and lets you act on it. What runs and groups are is described in [usage/runs.md](../usage/runs.md); this page covers where things are in the panel.

Addresses can be shared: `#runs/<run-id>` opens a run, `#runs/<run-id>/<group>` a group, and `#runs/<run-id>/<group>?tab=<tab>` a tab (`changes`, `task`, `design`, `tasks`, `artifacts`). The log is the default tab and is not written to the address.

## The run list

- Filters: a search (title, name, task number `#N`, pipeline, specialists, groups, tags), the switch "This repository" / "All repositories", and multiselects "State", "Pipeline", "Specialists", "Tags" and, for all repositories, "Repository".
- A run card shows the first line of the task, the status, the name of its pipeline (the id is in the tooltip), time, cost and a summary of changes (`2 files +367 −0`).
- A finished run with group warnings has a yellow "Warnings: N" badge.

## A run

- The first row of the header summary, "Status", holds the state of the run, its delivery and the status of the open group or step.
- The title is edited in place: Enter or leaving the field saves, Escape cancels.
- The action row has "Deliver", "Return to the queue" and "Steps".
- The "More" menu has "Retry failed (N)" ("Retry failed and cancelled (N)") and "Retry with current config (N)" when the run has failed or cancelled groups, then "Create subtask…", "Deliver with --force…" and "Copy run id".
- "Create subtask…" opens the [task form](queue.md#the-task-form) on the repository of the run with that run as the "Parent task". The text already typed in the dialog is kept.
- ["Retry with current config"](../usage/runs.md#retry-with-the-current-configuration) is also next to "Retry" in the "⋯" menu of a failed or cancelled group or split step. Commit message and resolver steps do not have it.

### Steps

The "Steps" block lists each step of the workflow with its state (done, running, upcoming) and a "Skip" switch for steps that are not finished yet.

- Skipping a running step asks for confirmation: the specialist is stopped without a commit, and its partial changes stay uncommitted in the group worktree.
- Turning the switch off brings the step back.
- Steps skipped when the run was created are not shown.

## A group

- The header has the step, round, time, changes, "Retry step", "Skip step" and "Cancel group".
- "Skip step" is shown for the step the group stands on, unless that step is skipped or finished. It skips the step for the whole run. The panel asks for confirmation when an attempt is running on the step or the run has more than one group.
- Above the tabs are the question to a human, warnings and [files changed outside the worktree](../configuration/README.md#outside_changes).

The tabs:

- **"Log"** shows the attempts of the group: specialist, runtime, verdict, tokens and cost. The log of a running attempt keeps loading by itself, and every entry carries the time it was received.
- **"Changes"** is a file tree with `+N −M`.
- **"Task"** shows the task text.
- **"Artifacts · N"** lists the [artifacts](../usage/runs.md#artifacts) of the group, newest first, with the step, title, file name, time and size. "Open" previews `.md` and `.log` files up to 1 MB, and "Download" saves any file. While the group has no artifacts the tab is dimmed, and `?tab=artifacts` falls back to the log.

### Message to the specialist

"Message to the specialist" sits on the right of the header of the last attempt, while it runs and has not reported. It interrupts the specialist: the attempt is stopped ("interrupted by a message") and the step continues in the same session as a new attempt that receives your text.

While the attempt is stopping, the header shows "interrupting…". Files changed before the interruption stay in the working copy. Cancelling the group at that moment drops the message.

## Questions

A specialist can ask [structured questions](../configuration/workflows.md#questions). They appear as the "Specialist questions · N" form above the tabs.

- A question shows its options as buttons. The recommended option has a "recommended" badge.
- The answer field is filled with the recommendation. "Answer" is unavailable while a field is empty.
- Drafts are kept until the answer is sent.
