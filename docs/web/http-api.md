# HTTP API

The [web panel](README.md) works through this API, served at its address. With `web.auth: token` (see [`web`](../configuration/README.md#web)) a request needs the token, and without it the answer is 401.

## Conventions

- The queue requests, `/api/config…` and `/api/pipelines` accept `repository=<absolute path>` or `repository=<project slug>`. Without it the most recently added enabled project is used; while there is none, the answer is 409.
- A relative path and a path outside a git repository are rejected with code 400. A `repository` field in the request body is ignored.
- Daemon refusals come back with code 400 and the error text, unless a request below says otherwise.

## Events

`/api/events` is a one-way stream of server-sent events (`text/event-stream`), not a WebSocket; commands go as the requests below. Besides runs and queues it carries:

- `repositories`: the list of repositories and its changes;
- `observers`: the [observers](settings.md#observers) after a change: the same object as the answer of `GET /api/observers`, in the field `observers`;
- `processes`: the background processes of the agents. The daemon looks at them every 2 seconds while someone is subscribed and sends the list when it changes.

The panel asks `GET /api/processes` once on opening and then every 3 seconds only while the page is visible and the stream is down or has sent no list.

## Runs

| Request | What it does |
|---|---|
| `GET /api/runs` | Active and recent runs |
| `GET /api/finished-runs?limit=<n>&before=<cursor>&repository=<path>` | A page of finished runs |
| `GET /api/runs/<id>` | One run |
| `POST /api/runs/<id>/title` | Changes the title |
| `POST /api/runs/<id>/tags` | Changes the tags |
| `POST /api/runs/<id>/skip` | Skips a step or brings it back |
| `POST /api/runs/<id>/cancel`, `POST /api/runs/<id>/pause` | Cancels or pauses a run |
| `POST /api/runs/<id>/apply` | Delivers groups |
| `POST /api/runs/<id>/delivered` | Marks groups as delivered |
| `POST /api/runs/<id>/observer` | Allows or forbids observers in a run |
| `GET /api/runs/<id>/patch` | Downloads the patch of the run |

- `GET /api/finished-runs` returns `{runs, next}`, newest created first.
  - `limit` is an integer from 1 to 100 (15 by default). `before` is the `next` of the previous page; leave it out for the first page. `next` is `null` on the last page.
  - A `limit` out of range, a `before` that is not a cursor or a `repository` that is not an absolute path is answered with 400.
- `POST /api/runs/<id>/title` takes `{"title": "<new title>"}` (trimmed, 1 to 60 characters) and returns the run. The short `name` stays, and a later answer of the naming model does not replace the title. An empty or too long title comes back with code 400, an unknown run with code 404.
- `POST /api/runs/<id>/skip` takes `{"step": "<step id>", "skip": true}` (`false` brings it back) and returns the run. A refusal (unknown step, a step every group has passed) comes back with code 400.
- `POST /api/runs/<id>/observer` takes `{"enabled": <boolean>}` and returns the run. `false` stops the repair in progress and forbids observers in this task; `true` gives it back and resets the repair count. A wrong body comes back with code 400, an unknown run with code 404.

### The patch of a run

`GET /api/runs/<id>/patch` downloads the patch of the merged groups as the attachment `<id>.patch` (`text/x-diff`). A run with no merged group is answered with 409.

- It is made by `git diff --binary` from the commit the run started on. Apply it with `git apply`, or with `--3way` when the files have moved on.
- The daemon saves the patch as a file when a group merges and before the run is cleaned up, so it can be downloaded after delivery.
- The file lies in `patches/<run id>/<commit>.patch` of the state directory, and the database keeps its URI (`file:`).
- The patch lives as long as the run record. Patches of unknown runs are removed when the daemon starts.

## Groups

All paths start with `/api/runs/<id>/groups/<group>`.

| Request | What it does |
|---|---|
| `GET …` | One group |
| `GET …/transcript` | The log of an attempt |
| `GET …/diff?path=<file>` | The diff of one changed file |
| `GET …/spec` | The spec change of the group (`change`, `path`, `design`, `tasks`) or `null`; an unknown group comes back with code 404 |
| `POST …/cancel`, `POST …/retry` | Cancels or retries a group |
| `POST …/answer` | Answers a question: `{"answer": "…"}` |
| `POST …/message` | Sends a [message to the specialist](runs.md#message-to-the-specialist) |
| `GET …/artifacts` | The artifacts of a group |
| `GET …/artifacts/<artifact>` | Downloads an artifact |

`GET …/diff` returns `{path, previousPath, binary, lines, totalLines, truncated}`.

- `lines` start at the first hunk and carry five lines of context around each change. A diff over 2000 lines is cut (`truncated`). A binary file has no lines.
- A missing `path` is answered with 400, a file the group did not change with 404, a diff that cannot be read any more with 409.

### Artifacts

`GET …/artifacts` returns the [artifacts](../usage/runs.md#artifacts), newest first: `{"artifacts": [{id, step, stepName, seq, specialist, title, fileName, size, createdAt, preview}]}`. `preview` is `markdown`, `log` or `null`. An unknown run or group comes back with code 404.

`GET …/artifacts/<artifact>` downloads an artifact as an attachment (`Content-Disposition` with an ASCII `filename` and a UTF-8 `filename*`).

- `Content-Type` is `text/markdown` for `.md`, `text/plain` for `.log` and `application/octet-stream` for everything else. Every answer has `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`, so an HTML or SVG artifact is never run in the page of the panel.
- With `?inline=1` the answer is `text/plain; charset=utf-8` without `attachment`, for `.md` and `.log` only; any other file comes back with code 400.
- An unknown run, group or artifact comes back with code 404, an artifact whose bytes are no longer available with code 409, any method but `GET` with code 405.
- The bytes lie in `artifacts/<run id>/<artifact id>` of the state directory, and the database keeps their URI (`file:`). They live as long as the run record. Files the database does not know are removed when the daemon starts.

## Queue

| Request | What it does |
|---|---|
| `GET /api/queue` | The queue of a repository |
| `POST /api/queue/items` | Adds a task |
| `POST /api/queue/items/<item>` | Changes a task |
| `POST /api/queue/items/<item>/remove` | Removes a task |
| `POST /api/queue/items/<item>/run` | Runs a task now |
| `POST /api/queue/start`, `POST /api/queue/pause` | Starts or pauses the queue |
| `POST /api/queue/return` | Returns a run to the queue |
| `POST /api/queue/dismiss` | Removes a run from the skipped list |
| `POST /api/queue/settings` | Changes the queue settings |

- `POST /api/queue/dismiss` takes `{"run": "<run id>"}` and returns the queue. A run that is not skipped comes back with code 400, an unknown run with code 404.
- `POST /api/queue/settings` takes `parallel`, `autopilot`, `autoAnswer`, `skipFailed`, `autopilotAnswer` and `onLimit`, all optional. An empty body is answered with 400.

## Observers

| Request | What it does |
|---|---|
| `GET /api/observers` | The settings of the observers and the repairs in progress and waiting |
| `GET /api/observers/history` | A page of saved observer repair attempts across all projects |
| `PUT /api/observers` | Saves the settings |


## Statistics

| Request | What it does |
|---|---|
| `GET /api/stats` | The [usage report](../configuration/stats.md#report) of the daemon |
| `DELETE /api/stats?repository=<path>` | Deletes the records of a project and returns `{"removed": <count>}` |

- `GET /api/stats` takes `since` and `until` (moments in milliseconds; without them all time) and `repository` (an absolute path or a slug; without it all projects). A wrong value comes back with code 400.

## Configuration

| Request | What it does |
|---|---|
| `GET /api/config` | The configuration and its `revision` |
| `GET /api/config/catalog` | The catalog of skills and tools for suggestions |
| `GET /api/pipelines` | The pipelines of a repository |
| `PUT /api/config/settings`, `PUT /api/config/settings/<path>` | Writes several fields or one field of `settings.yaml` |
| `PUT /api/config/mcp-servers/<name>`, `DELETE /api/config/mcp-servers/<name>?revision=…&level=…` | Writes or removes one server of the `mcp_servers` catalog of a level; a variable of `env` sent as `null` keeps its value in the file, and the values of `env` are never returned |
| `PUT /api/config/specialists/<slug>`, `PUT /api/config/pipelines/<id>` | Writes a file |
| `DELETE /api/config/specialists/<slug>`, `DELETE /api/config/pipelines/<id>` | Deletes a file |
| `POST /api/config/pipelines/<id>/preview` | The graph of a draft |
| `POST /api/config/specialists/import`, `POST /api/config/pipelines/import` | Imports from another repository |
| `GET /api/shared-specialists`, `GET /api/shared-pipelines` | Shared entries with their usage |
| `GET /api/specialist-tags` | The tags of specialists |
| `PUT /api/specialist-tags/specialists/<slug>` | Sets the tags of a specialist |
| `POST /api/specialist-tags/rename`, `POST /api/specialist-tags/remove` | Renames or removes a tag of specialists |

Writing `settings.yaml`:

- The bodies are `{"value": …, "revision": …, "level": …}` for one field and `{"values": {"<path>": …}, "revision": …, "level": …}` for several.
- `level` is `global` (default) or `project`; `revision` is the one from `GET /api/config`; a value `null` removes the key.
- A path outside the list of fields is answered with 404, a value of a wrong kind with 422, an old revision with 409.
- `web.*` and `runtimes.*` are written on `global` only.

## Tags

| Request | What it does |
|---|---|
| `GET /api/tags` | The catalog of a repository |
| `POST /api/tags` | Creates a tag |
| `POST /api/tags/edit` | Changes a tag |
| `POST /api/tags/remove` | Removes a tag |

## Repositories

| Request | What it does |
|---|---|
| `GET /api/repositories` | The projects with counters, `displayPath` (the path with the home directory written as `~`), `name`, `label` (the name or the directory name), `slug`, `enabled` and `color` |
| `POST /api/repositories` | Adds one: `{"path": "<absolute path or ~/…>", "name"?, "slug"?, "color"?}` |
| `PATCH /api/repositories?repository=<path or slug>` | Changes a project: any of `name` (or `null`), `slug`, `enabled`, `color` (or `null`) |
| `POST /api/repositories/move?repository=<path or slug>` | Gives a project a new path: `{"to": "<absolute path or ~/…>"}` |
| `DELETE /api/repositories?repository=<path or slug>` | Removes one |
| `GET /api/directories?path=<absolute path or ~/…>` | The folder browser of the path fields: `path`, `parent` (null at `/`), `home`, `git` and `entries` (`name`, `path`, `git`: the folder holds `.git`), at most 500 subfolders without hidden ones, `truncated` when there are more; without `path`, the home directory |

Each of them answers with the list. A relative `path` or `to`, and a body with unknown fields, are rejected with code 400 without contacting the daemon. See [Multiple repositories](../usage/repositories.md#projects) for what the attributes do.

## Processes

`GET /api/processes` returns the background processes of the agents (`{"processes": [...]}`). `POST /api/processes/<pid>/kill` terminates one; a PID that is not a number comes back with code 400, a PID that is not in the list with code 404.

## System

- `GET /api/system` returns the state of the daemon and of the panel (the address has no token) and `network`: `state`, `problem`, `checkedAt`, `since` and the `proxy` of the check (from the settings or the daemon environment) without login and password.
- `POST /api/system/web/restart` and `POST /api/system/daemon/restart` (body `{"force": true}` optional) answer 202 `{"state": "restarting"}` and restart after the answer is sent.
- `POST /api/system/daemon/stop` and `POST /api/system/daemon/start` stop and start the daemon.
- The answer is 409 with `code` `daemon_busy` for a busy daemon without `force`, and `web_standalone` for a panel started by `aip web`.
