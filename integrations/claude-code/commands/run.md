---
description: Queue an aip pipeline task in this repository
argument-hint: <pipeline> <task>
---

Queue an aip pipeline task with the arguments `$ARGUMENTS`: the first word is the pipeline, the rest is the task. Run `aip run start <pipeline> --task "<task>" --repo .`. The task goes to the end of the repository queue and a stopped queue is started. Report the run id and its groups if the run was created, otherwise the queue position of the task.
