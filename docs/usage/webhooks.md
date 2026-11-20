# Outgoing webhooks

The daemon can call an address you choose when a task needs you or something finishes. The request is a signed JSON `POST` in the [Standard Webhooks](https://www.standardwebhooks.com) format, so any of its libraries verifies it. A webhook only sends: it takes no answers back.

A webhook is a connection of the kind `webhook` with exactly one subscription, made together by `aip webhook add`. Its commands take the id of the webhook (`aip webhook list`).

## Creating a webhook

```
aip webhook add ci --url https://ci.example.com/aip --repo .
openssl rand -base64 32 | sed 's/^/whsec_/' | aip integration secret set <id> signing_secret --stdin
aip webhook enable <id>
aip webhook test <id>
```

- A webhook starts disabled and cannot be enabled without `signing_secret`. The secret is `whsec_` plus base64, or any text of at least 24 bytes. It is read from standard input only, never from an argument or the panel, and never printed.
- `--url` is an `http` or `https` address without a login or password, up to 2048 characters. Lists, the journal and the panel show it without the query (`https://ci.example.com/hook`), because a token often sits there.
- `--repo <project>` or `--all-projects` sets the scope; `--events` chooses event kinds (default `question`): `question`, `failed`, `conflict`, `delivery`, `finished`.
- `aip webhook edit <id> --url … --events …` changes the address and the events. `aip webhook disable`, `enable` and `remove` work as for any connection; `aip integration enable` after a switch-off works too.
- `aip webhook test <id>` sends one `webhook.test` call, also while the webhook is disabled, and prints the answer code and time.

## What is sent

Headers: `webhook-id` (the same for every attempt of one delivery), `webhook-timestamp` (seconds), `webhook-signature` (`v1,` plus the base64 HMAC-SHA256 of `<id>.<timestamp>.<body>`), `content-type: application/json`.

```json
{
  "type": "question.asked",
  "timestamp": "2026-11-20T10:00:00.000Z",
  "data": {
    "schema": 1,
    "key": "run/group/needs_human/1",
    "task": { "id": "…", "number": 12, "title": "…", "pipeline": "feature", "project": "app" },
    "group": { "slug": "login", "title": "…", "step": "plan", "status": "needs_human" },
    "url": "https://aip.example.com/…",
    "question": [{ "text": "…", "options": ["…"], "recommendation": null }],
    "human_only": false
  }
}
```

| `type` | When | Extra fields of `data` |
| --- | --- | --- |
| `question.asked` | a specialist asks | `question`, `human_only` |
| `question.closed` | the question was answered or cancelled | `closed.by` (`human`, `autopilot`, `observer`, `cancelled`, a channel, `other`) |
| `group.failed`, `group.conflict`, `delivery.failed` | a group failed, hit a merge conflict, or could not be delivered | `reason` |
| `task.finished` | the task ended | `result`, `groups.merged`, `groups.total` |
| `webhook.test` | `aip webhook test` | `message` |

`url` is set only when `settings.yaml` has a public panel address. Paths of your machine and secrets are never in the body. A body over 256 KiB is shortened and gets `"truncated": true`.

## Verifying a request

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, headers, rawBody) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice(6), 'base64')
    : Buffer.from(secret);
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return headers['webhook-signature'].split(' ').some((part) => {
    const [version, value] = part.split(',');
    const given = Buffer.from(value ?? '', 'base64');
    return version === 'v1' && given.length === expected.length && timingSafeEqual(given, expected);
  });
}
```

Check the signature over the raw body, reject a timestamp more than five minutes off, and deduplicate by `webhook-id`: a retry repeats it.

## Retries and switching off

Any answer but 2xx, a redirect (never followed), a timeout (10 seconds) or a network error is a failed attempt. A delivery has 8 attempts, after 5 s, 1 min, 10 min, 1 h, 3 h, 7 h and 11 h; `Retry-After` of a `429` shortens a pause but never lengthens it.

Each attempt is in the journal with its time, code or error kind, duration and the first 1024 characters of the answer: `aip webhook log <id>` (`--state failed`, `--limit`).

`aip webhook redeliver <delivery>` starts a new series for the same delivery with the same `webhook-id`. A `webhook.test` call is never sent again: run `aip webhook test` once more.

Three failed deliveries in a row, or one `410 Gone`, switch the webhook off with the reason shown by `aip webhook list` and the panel. What happened while it was off is not sent after `enable`. One slow receiver does not delay other webhooks or chats; one webhook has at most 4 requests in flight. The journal keeps 30 days.

## Changing the secret

The receiver should accept both secrets for a while: set the new one with `aip integration secret set <id> signing_secret --stdin`, then update the receiver. Deliveries waiting for a retry are signed with the new secret when they go out.

## Network

With `network.proxy` set (see [network](../configuration/network.md)), every address except loopback goes through the proxy with `CONNECT`; the proxy sees the host and port, not the path or query. Loopback addresses (`127.0.0.1`, `localhost`) are called directly.

The panel (settings → "Shared" → "Integrations", tab "Webhooks") creates, switches, tests and edits webhooks and shows the journal with a button to send a delivery again; it shows the command for the secret instead of asking for it.
