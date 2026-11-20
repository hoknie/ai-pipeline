# Notifications

The daemon can write to a chat when a task needs you and take your answer from the chat. Channels are a Telegram bot and a Slack app. The daemon does not need a public address: it asks Telegram for updates itself (long polling) and connects to Slack itself (Socket Mode).

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

## Setting up a Slack app

1. Create an app [from a manifest](https://api.slack.com/apps) and install it in your workspace:

```yaml
display_information:
  name: aip
features:
  bot_user:
    display_name: aip
oauth_config:
  scopes:
    bot:
      - chat:write
      - channels:history
      - groups:history
settings:
  event_subscriptions:
    bot_events:
      - message.channels
      - message.groups
  interactivity:
    is_enabled: true
  socket_mode_enabled: true
```

2. Keep the bot token (`xoxb-…`, *OAuth & Permissions*) and create an app-level token with the scope `connections:write` (`xapp-…`, *Basic Information*).
3. Invite the app to the channel (`/invite @aip`). The channel id (`C…` or `G…`) is in the channel details; your user id (`U…`) is in your profile (*Copy member ID*).
4. Create the connection, give it both secrets and subscribe a project:

```
aip integration add slack team --global --param channel_id=C0123456789 --param allowed_users=U01AAAAAAA,U01BBBBBBB
aip integration secret set <id> bot_token --stdin < bot-token.txt
aip integration secret set <id> app_token --stdin < app-token.txt
aip integration enable <id>
aip notify add <id> --repo . --events question,failed
aip notify test <subscription>
```

Optional parameters: `team_id` (`T…`) accepts events of one workspace only, `language` is `en` or `ru`. One Slack app belongs to one daemon: Slack shares events between several connections of the same app.

In Slack, a question has a button for every option (up to 5; more options are a drop-down list), then **Accept recommendations** and **Custom answer**. Write a text answer as a reply in the thread of the message, `N: text` for several questions.

A user outside `allowed_users`, or a press on a closed question, gets a message that only they see. Without the scope `channels:history` (`groups:history` for a private channel) replies in a thread do not arrive; `aip notify test` warns about it.

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

Messages hold the project name, pipeline, task number and title, group title, the question with its options, the reason of a failure or the summary of a step, and a link to the task when [`web.public_url`](../configuration/README.md#web) is set. They do not hold code, diffs or secrets.

Texts longer than the limit of the channel (4096 characters in Telegram, 3000 per block in Slack) are shortened; every option stays a button.

## Delivery, retries and the journal

A message that Telegram does not accept is retried after 5 s, 30 s, 2 min, 10 min and 30 min, then marked `failed`; a refusal that cannot get better (a wrong chat, a blocked bot) is `failed` at once. Telegram's `retry_after` is honoured. Tasks never wait for the chat.

```
aip notify log                        # the newest 20 lines
aip notify log --state failed --limit 5
```

The same journal, the state of every channel and the parameters of the connections are in the group **Integrations** of the shared settings in the [web panel](../web/README.md): the tabs "Connections" and "Notifications".
A connection is made, switched on and off and removed there.
The panel labels kinds, parameters and secrets in its own language and shows the technical name (the one used by `aip integration`) in small type under the label; the bot message language is chosen from a list: each language under its own name, or the default (English).

For a missing secret the card shows the command that sets it, with a button to copy it; the secret itself is never typed in the panel.

## Network

Calls to Telegram and Slack, and the Socket Mode connection, use the proxy of the [`network`](../configuration/network.md) section, or `HTTPS_PROXY` of the daemon environment. `AIP_TELEGRAM_API` of the daemon environment replaces `https://api.telegram.org`, for a private Bot API server; `AIP_SLACK_API` replaces `https://slack.com/api`.

## Errors

- **401** — the token is wrong or revoked. Polling stops until you replace the secret or enable the connection again.
- **409** — the bot has a webhook or another program polls it. Delete the webhook of the bot (`deleteWebhook`) or stop the other poller; the daemon asks again once a minute.
- A subscription to a connection without `chat_id` cannot be enabled; if `chat_id` is removed later, its messages fail with the reason `chat_id is not set`.
- Slack `invalid_auth` — a token is wrong or revoked; the connection stops until you replace the secret or enable it again. `not_in_channel` — invite the app to the channel; the message is `failed` without retries.
