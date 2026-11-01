---
description: Queue an aip workflow task in this repository
argument-hint: <workflow> <task>
---

Queue an aip workflow task with the arguments `$ARGUMENTS`: the first word is the workflow, the rest is the task. Run `aip run start <workflow> --task "<task>" --repo .`. The task goes to the end of the repository queue and a stopped queue is started. Report the run id and its groups if the run was created, otherwise the queue position of the task.
