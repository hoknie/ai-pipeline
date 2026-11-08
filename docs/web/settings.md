# Settings in the web panel

The "Settings" section is a set of forms for the [`aip/` configuration](../configuration/README.md), in two tabs. "Shared" edits the shared `settings.yaml`, and "Project" edits the `aip/settings.yaml` of the selected repository.

A block under the tabs, "Where the settings are saved", shows the file the open group saves to. On "Project" it also has a "Project" selector with the full path of the repository; choosing one switches the repository of the whole panel. The groups "Queue" and "Tags" show no file. Without repositories "Project" shows only a note.

The address is `#settings/<tab>/<group>`, for example `#settings/global/delivery` or `#settings/project/queue`. An unknown group opens "General" of the tab.

## Shared groups

"General" (runs, working copy, naming), "Agents" (defaults and Claude), "Delivery", "Runtimes" (Claude, OpenCode and Antigravity CLI), ["Specialists"](#shared-specialists), ["Pipeline"](#shared-pipelines), ["Observers"](#observers) and ["System"](#system). Fields of `web.*` and `runtimes.*` exist only here.

## Project groups

"General", "Agents", "Delivery", "Queue" and "Tags".

- ["Queue"](queue.md#queue-modes) holds the modes of the queue, which switch at once without "Save".
- "Tags" is the [tag catalog](../usage/tags.md) of the repository, in two cards: "Regular tags" (label, name, color, delete) and, when there are any, "Linked task tags" (name and delete, without a color choice).

[Linked task tags](../usage/tags.md#linked-task-tags) are shown as `#115: name`. The label is a link to the task that created the tag. These tags are not offered in the tag pickers, cannot be created there, and are never sent when other tags of a task or run change.

## Forms

- Every field of `settings.yaml` that the panel shows is a form control: a switch, a selector, a number, a text, a duration (`30m`) or a list of strings.
- "Save" writes all changed fields of the group to the file of the tab in one write; comments and other keys of the file stay. "Discard changes" returns the form to the saved values. An empty field removes the key.
- "Shared" does not change a value set in the project file, and "Project" does not change the shared file.
- On "Project" a field set in the project has the button "Inherit", which removes the key from the project file. A field without a project value shows the shared (or built-in) value with a mark of where it comes from.
- Errors of validation are shown at the fields. If the file was changed after it was read, the form offers "Reload".
- Leaving a group, a tab or a project with unsaved changes asks for confirmation.
- A group with configuration errors gets a mark, and the errors are shown in the group. Errors of specialists and pipelines are shown in "General".
- Of the runtime environment only the names of the variables are shown, never their values: a value can be added or replaced, not read. Runtime settings are reread before the next agent starts. A change of `web.*` takes effect after the restart: see [System](#system).

## Shared specialists

The group "Specialists" of "Shared" edits the files of the shared `specialists/` directory: a list on the left and a form on the right. The form saves to the shared file; there is no level switch.

- The block "Used in projects" shows the number of repositories where the specialist is used and the list of them, with the pipeline and step, `split` or delivery field that refer to it. References from the shared pipelines and shared `delivery.*` get a separate line "Shared level".
- A specialist is used in a repository when the configuration of the repository refers to it and the repository has no project file with that name.
- "Delete" stays disabled while the specialist is used anywhere. The daemon checks this too, and refuses with the references and the repositories they come from.

## Shared pipelines

The group "Pipeline" of "Shared" edits the files of the shared `pipelines/` directory: a list with search by id, name and tag, and a form that saves to the shared file. The shared tags are edited here. Only shared specialists can be chosen for the steps. A change applies in every repository.

- The block "Used in projects" lists the repositories where a `split.pipeline` refers to the pipeline. References from other shared pipelines get the line "Shared level". A repository with its own file of that id is not counted.
- "Delete" stays disabled while the pipeline is used anywhere. The daemon checks this too, across all repositories of the panel, and refuses with the references.

The addresses are `#settings/global/pipelines`, `#settings/global/pipelines/<id>` and `#settings/global/pipelines/new`.

## Observers

The group "Observers" of "Shared" sets the agents that take a task after an incident (a question, a failed step, a conflict or a refused delivery) and try to repair it. The address is `#settings/global/observers/<tab>`; an unknown tab opens "Main", and choosing a tab changes the address. The three tabs are one form: "Save" writes them together, and the errors of validation are shown at the fields.

- "Main": the switch "Enable observers", "Workers" (1 to 20, how many observers work at once), "Repairs per task" (1 to 50) and the switch "Answer questions meant only for a human" (off: such a question waits for a person; on: the agent decides it). Under the fields are the repairs in progress and the number of tasks waiting for a worker; they follow the stream without a reload.
- "Specialist": the fields of the specialist that works as the observer, as in a specialist form, but without the slug, tags, limit and queue.
- "Projects": the repositories of the registry, each with a switch "Connect" and the field "Workers in the project", empty by default (no limit of its own).

## System

"System" shows the state of the [daemon](../usage/daemon.md) (pid, version, build, whether agents work) and of the panel (pid, address without the token, access, build), refreshed every 3 seconds, and the path of the daemon log.

- "Restart panel" restarts the panel on its address with its token; the page comes back by itself. The daemon and its agents keep running.
- "Restart daemon" runs `aip daemon restart --web` as a separate process. While agents work the panel asks again, and "Restart, stopping the agents" runs it with `--force`.
- "Stop daemon" asks for confirmation and runs `aip daemon stop --web` as a separate process. While agents work the panel asks again, and "Stop, stopping the agents" runs it with `--force`. The page stays open: a [stand-in process](../usage/daemon.md#the-panel-and-the-daemon) serves it while the daemon is stopped.
- A stopped daemon shows "Start daemon": it starts the daemon, which takes the panel back. The panel cannot be restarted while the stand-in serves it.
- A panel started by `aip web` itself cannot restart, stop or start anything: do it in the terminal.
- The page waits up to 30 seconds for the part to answer, and otherwise points to the daemon log.
