# Access control

In [server mode](server.md) every request is checked against the rights of the person who sends it. The rights come from two places: the built-in roles and the rules in `access.yaml`. Local mode has no rights: `access.yaml` is not read and everything is allowed.

## Roles

A user's `role` attribute (set with `aip server users set <email> role=developer`, or taken from the sign-in provider, see [sso.md](sso.md)) picks a built-in set of rights:

| Role | May |
|---|---|
| `admin` | everything |
| `developer` | everything except `config.global.write`, `project.add`, `project.update`, `project.remove`, `users.manage`, `audit.read` and `stats.clear` |
| `viewer` | read only: the actions ending in `.read`, except `audit.read` |

A user without `role` gets the role from `server.default_role` in the shared `settings.yaml` (`admin`, `developer` or `viewer`; not set by default). Without a role and without a default, a person can do nothing but manage their own tokens, ask `whoami` and sign out. The daemon log names such users when it starts.

```yaml
server:
  enabled: true
  public_url: https://aip.example.com
  default_role: developer
```

Everyone may always manage their own tokens, ask `whoami` and sign out. `local` (no server mode) and the daemon's own socket on the server are never checked.

## `access.yaml`

The file lies next to the shared `settings.yaml` (`~/.config/aip/access.yaml`). It is read again within 10 seconds of a change; a file with a mistake is ignored with a line in the daemon log, and the last valid version stays in force.

```yaml
presets: true
rules:
  - id: payments-own-projects
    effect: allow
    actions: [queue.*, run.*]
    subject: { groups: [payments] }
    resource: { repository: [billing, ledger] }
  - id: contractors-no-apply
    effect: deny
    actions: [run.apply]
    subject: { groups: [contractors] }
```

| Field | Meaning |
|---|---|
| `presets` | `true` (default) keeps the built-in roles, `false` leaves only your rules |
| `rules[].id` | A unique name; `aip access check` shows it |
| `rules[].effect` | `allow` or `deny` |
| `rules[].actions` | Action names; `*` stands for any characters: `run.*`, `*.read`, `*` |
| `rules[].subject` | Attribute name → values; the user needs at least one of them for each attribute (`groups: [payments]`, `role: [viewer]`) |
| `rules[].resource` | Conditions on what the action is done to, see below |

`resource` takes `repository` (project slugs, `*` for any), `pipeline`, `tags` (at least one of the tag names) and `author: self` (the author of the run or the task is the user). Every condition of a rule must hold; a condition on an attribute the resource does not have is not met.

The decision looks at every rule and role that matches. If one of them is a `deny`, the action is refused; otherwise if one is an `allow`, it passes; otherwise it is refused. The order of the rules does not matter.

### Examples

Teams work only in their own projects, and nobody else can change them:

```yaml
presets: false
rules:
  - id: everyone-reads
    effect: allow
    actions: ['*.read']
  - id: payments
    effect: allow
    actions: [queue.*, run.*, config.write, tag.write]
    subject: { groups: [payments] }
    resource: { repository: [billing, ledger] }
```

Everyone reads, starts runs and adds tasks, but only the author or a lead cancels and answers:

```yaml
presets: false
rules:
  - id: read-and-work
    effect: allow
    actions: ['*.read', run.start, queue.add]
  - id: own-runs
    effect: allow
    actions: [run.cancel, run.answer]
    resource: { author: self }
  - id: leads
    effect: allow
    actions: [run.cancel, run.answer]
    subject: { groups: [leads] }
```

Contractors look but do not deliver:

```yaml
rules:
  - id: contractors-read-only
    effect: deny
    actions: [run.apply, queue.add, run.start]
    subject: { groups: [contractors] }
```

## Actions

`aip access actions` lists them with what each is done to. A method of the daemon needs one action; for example `cancel` needs `run.cancel` on the run, `queue_add` needs `queue.add` on the project, `apply` needs `run.apply` on the run, and settings calls need `config.write` on a project or `config.global.write` on the shared level.

| Action | What it allows |
|---|---|
| `project.read` | see a project, its runs, queue, tags and statistics |
| `project.add`, `project.update`, `project.remove` | add, rename, disable, move or remove a project |
| `run.read` | read a run: groups, logs, diffs, artifacts |
| `run.start`, `run.cancel`, `run.retry`, `run.skip`, `run.configure`, `run.answer`, `run.apply` | work with runs; `run.configure` is the title, tags, variant, provider, pause and observer; `run.apply` also marks a run delivered |
| `queue.read`, `queue.add`, `queue.edit`, `queue.control` | read the queue, add a task, edit, remove or return a task, start, pause or configure a queue |
| `tag.write` | add, edit or remove a tag |
| `config.read`, `config.write`, `config.global.write` | read the configuration, write a project's, write the shared one and the observers |
| `stats.read`, `stats.clear` | read or clear the statistics |
| `observers.read`, `integration.read`, `integration.write`, `process.read`, `process.kill`, `daemon.control` | observers, integrations, background processes, stopping the daemon or the panel |
| `users.read` | the list of users (id, email, name) behind the author filters |
| `audit.read`, `users.manage` | the [audit journal](server.md#audit-journal), users and login links |

## What a user sees

Lists of runs, queues, projects, tags and statistics hold only the projects the user can `project.read`; the event stream of the panel does too. A run or a task of another project answers as if it did not exist (404). The panel turns off a button the user may not press and says which action is missing; the server checks the rights on its own.

A refused request gets the code `access.denied` (403) with the action and the project, and the [audit journal](server.md#audit-journal) gets an entry with the outcome `denied`.

## Explaining a decision

An administrator asks why:

```
aip access check --user bob@corp.com --action run.apply --repo billing
aip access check --user bob@corp.com --action run.cancel --run <id> --json
```

The output names the decision, the rules and roles that matched (`preset:developer`, `contractors-no-apply`), the attributes of the user and of the resource. `aip config check` validates `access.yaml` too: a mistake is reported with its field, such as `rules[0].actions[0]`, and the close action names.

## Moving from "everyone but administrators"

Without a `role` and without `server.default_role` a user is refused everything. To keep the behaviour of a server where everyone but the administrators could work, set `server.default_role: developer`; administrators keep `role: admin`. To remove all limits from the file, delete `access.yaml`: the built-in roles stay.
