# Notifications

The daemon can write to a chat when a task needs you and take your answer from the chat. The first channel is a Telegram bot. The daemon does not need a public address: it asks Telegram for updates itself (long polling).

A *connection* holds the bot (token, chat, allowed users) and is shared or belongs to one project; a *subscription* says which project sends which events through it. Connections are described in the `aip integration` commands, subscriptions in `aip notify`. A secret is never given in an argument or in the panel.

## Setting up a Telegram bot

1. Create a bot with [@BotFather](https://t.me/BotFather) and keep its token.
2. Create the connection with your Telegram user id in `allowed_users` (the ids of everyone whose answers count, separated by commas). Write to the bot `/id` to learn your user id, in the chat you want to use to learn the chat id too.

```
aip integration add telegram main --global --param allowed_users=111,222
aip integration secret set <id> bot_token --stdin < token.txt
aip integration enable <id>
```

3. Write `/id` to the bot in the chat that should get the messages (a private chat, a group or a supergroup) and set the chat:

```
aip integration edit <id> --param chat_id=-1001234567890
```

4. Subscribe a project and check the channel:

```
aip notify add <id> --repo . --events question,failed
aip notify test <subscription>
```

`aip integration edit` changes non-secret parameters of an enabled connection without restarting the daemon: the bot is polled again with the new values. `language` (`en` or `ru`) is the language of the messages; `--unset language` returns the default.

Without `--events` a subscription gets `question` only. `--all-projects` subscribes every project of a shared connection. Questions that are already open when you subscribe are not sent.

## Events

| Event | When |
| --- | --- |
| `question` | a group waits for a person: a question of a specialist, a step review or a request for a person |
| `failed` | a group failed (not a usage limit: the queue waits for that on its own) |
| `conflict` | merging a group conflicted |
| `delivery` | delivery of a run failed |
| `finished` | a task ended: finished, failed or cancelled |

Only `question` messages have buttons; the others are information.

## Answering from the chat

- One question with options: press the option.
- Several questions: each has its own row of buttons; the message shows what is chosen. **Accept recommendations** takes the recommended option of every question that has one. When every question has an answer, the answer is sent to the group in the same form as an answer from the panel, and the message says who answered.
- **Custom answer** (and **Rework** for a step review) asks for a reply to the bot's prompt. Write `N: text`, where `N` is the question number; a task with one question takes plain text.
- A step review has **Accept** and **Rework**.

Only users from `allowed_users`, in the chat `chat_id`, can answer; anyone else gets a refusal and nothing changes. A button pressed after the question was answered elsewhere (panel, CLI, autopilot, another chat) changes nothing: the message is already closed and says who closed it.

## What leaves your machine

Messages hold the project name, pipeline, task number and title, group title, the question with its options, the reason of a failure or the summary of a step, and a link to the task when [`web.public_url`](../configuration/README.md#web) is set. They do not hold code, diffs or secrets. Texts longer than 4096 characters are shortened; every option stays a button.

## Delivery, retries and the journal

A message that Telegram does not accept is retried after 5 s, 30 s, 2 min, 10 min and 30 min, then marked `failed`; a refusal that cannot get better (a wrong chat, a blocked bot) is `failed` at once. Telegram's `retry_after` is honoured. Tasks never wait for the chat.

```
aip notify log                        # the newest 20 lines
aip notify log --state failed --limit 5
```

The same journal, the state of every channel and the parameters of the connections are on the **Integrations** page of the [web panel](../web/README.md). For a missing secret the page shows the command that sets it.

## Network

Calls to Telegram use the proxy of the [`network`](../configuration/network.md) section, or `HTTPS_PROXY` of the daemon environment. `AIP_TELEGRAM_API` of the daemon environment replaces `https://api.telegram.org`, for a private Bot API server.

## Errors

- **401** — the token is wrong or revoked. Polling stops until you replace the secret or enable the connection again.
- **409** — the bot has a webhook or another program polls it. Delete the webhook of the bot (`deleteWebhook`) or stop the other poller; the daemon asks again once a minute.
- A subscription to a connection without `chat_id` cannot be enabled; if `chat_id` is removed later, its messages fail with the reason `chat_id is not set`.
