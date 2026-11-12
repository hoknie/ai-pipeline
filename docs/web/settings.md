# Settings in the web panel

The "Settings" section is a set of forms for the [`aip/` configuration](../configuration/README.md), in two tabs. "Shared" edits the shared `settings.yaml`, and "Project" edits the `aip/settings.yaml` of the selected repository.

A block under the tabs, "Where the settings are saved", shows the file the open group saves to. On "Project" it also has a "Project" selector with the full path of the repository; choosing one switches the repository of the whole panel. The groups "Queue" and "Tags" show no file. Without repositories "Project" shows only a note.

The address is `#settings/<tab>/<group>`, for example `#settings/global/delivery` or `#settings/project/queue`. An unknown group opens "General" of the tab.

## Shared groups

"General" (runs, working copy, naming), "Agents" (defaults and Claude), "Delivery", "Runtimes" (Claude, OpenCode and Antigravity CLI), ["Specialists"](#shared-specialists), ["Pipeline"](#shared-pipelines), ["Observers"](#observers), ["Projects"](#projects) and ["System"](#system). Fields of `web.*`, `runtimes.*`, `network.*` and `stats.*` exist only here.

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
- Every card of "Runtimes" starts with the switch "Enabled": all runtimes are off until you switch them on, and a card of an off runtime is marked "(off)". See [Runtimes](../configuration/runtimes.md).
- Environment variables of a runtime are added one by one: fill "Name" and "Value", then press Enter or "Add variable" and repeat for the next one.

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

The group "Observers" of "Shared" sets the agents that take a task after an incident
(a question, a failed step, a conflict or a refused delivery) and try to repair it.
The address is `#settings/global/observers/<tab>`; an unknown tab opens "Main", and
choosing a tab changes the address. The three settings tabs are one form: "Save"
writes them together, and the errors of validation are shown at the fields.
"History" is a separate read-only tab and does not depend on whether observers are enabled.

- "Main": the switch "Enable observers", "Workers" (1 to 20, how many observers work at once), "Repairs per task" (1 to 50) and a note that questions with a human review or marked "Human needed" are never taken by observers: they always wait for a person. Under the fields are the repairs in progress and the number of tasks waiting for a worker; they follow the stream without a reload.
- "Specialist": the fields of the specialist that works as the observer, as in a specialist form, but without the slug, tags, limit and queue.
- "Projects": the repositories of the registry, each with a switch "Connect" and the field "Workers in the project", empty by default (no limit of its own).
- "History": saved attempts by the observer across all projects, newest first.

## Projects

The group "Projects" of "Shared" manages the [projects of the daemon](../usage/repositories.md#projects). On the left is every project, disabled ones too (marked "Disabled"), with its slug, path and runs waiting for an answer, a search by name, slug or path, and "Add project". The address is `#settings/global/projects/<slug>` for a project and `#settings/global/projects/new` for a new one.

- The form of a project has "Name" (empty: the directory name), "Slug", "Path" with "Change path…", the switch "Enabled" and "Color". Below are when it was added and its unfinished runs, runs waiting for an answer and queued tasks.
- "Save" sends the changed fields; a refusal of the daemon, such as a taken slug, is shown at its field. Leaving a form with unsaved changes asks first.
- Disabling the selected repository of the panel selects the default one. A disabled project is not in the repository picker, in the picker of a new task or in "Project" of the project tab.
- "Change path…" moves the project to another root. The field starts with the current path (`~` for the home directory), takes `~/…`, and has "Browse…". The queued tasks move with the project; the dialog keeps the refusal while the project has unfinished runs.
- "Project settings" and "Queue" make the project the selected repository and open its settings or its queue. "Remove from list" asks first. The daemon refuses while the repository has unfinished runs or queued tasks; a queue left running without tasks does not hold it. Removing the selected project selects the default one and the browser forgets the choice.

## System

"System" shows the state of the [daemon](../usage/daemon.md) (pid, version, build, whether agents work) and of the panel (pid, address without the token, access, build), refreshed every 3 seconds, and the path of the daemon log.

- The card "Network" shows the [state of the network](../configuration/network.md): "Check is off", "Available" or "Unavailable" with the reason, when the state changed, when it was last checked and the proxy of the check (from the settings or the daemon environment) without its login and password. It updates on the `network` event and with the poll.
- The form "Network" sets the `network` section of the shared settings. Changes apply from the next check, without restarting the daemon; while the network is down, agents do not start.
- The form "Statistics" sets the `stats` section of the shared settings: "Collect statistics", "Show cost" and the excluded projects. See [Statistics](stats.md).
  - Excluded projects are chosen from the list of projects, with the path. A path that is not in the list is marked "not in the registry" and can be removed.
  - An excluded project is no longer collected and is hidden from the reports; its records stay.
  - Changes apply without restarting the daemon.
- "Restart panel" restarts the panel on its address with its token; the page comes back by itself. The daemon and its agents keep running.
- "Restart daemon" runs `aip daemon restart --web` as a separate process. While agents work the panel asks again, and "Restart, stopping the agents" runs it with `--force`.
- "Stop daemon" asks for confirmation and runs `aip daemon stop --web` as a separate process. While agents work the panel asks again, and "Stop, stopping the agents" runs it with `--force`. The page stays open: a [stand-in process](../usage/daemon.md#the-panel-and-the-daemon) serves it while the daemon is stopped.
- A stopped daemon shows "Start daemon": it starts the daemon, which takes the panel back. The panel cannot be restarted while the stand-in serves it.
- A panel started by `aip web` itself cannot restart, stop or start anything: do it in the terminal.
- The page waits up to 30 seconds for the part to answer, and otherwise points to the daemon log.
