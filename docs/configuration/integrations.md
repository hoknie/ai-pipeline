# Integrations

An integration is a local *connection* of a project (or of all projects) to an external system. This version ships the registry, the secret storage, the safe entry and exit points and three kinds: `telegram` and `slack` (chats for [notifications](../usage/notifications.md)) and `service-registry` (see [below](#service-registry)). A connection reaches out only while it is enabled.

A connection has a kind, a name (unique per kind in its scope), non-secret parameters and secret slots. A project can have several connections of one kind (two accounts). Connections live in the daemon's SQLite database; **secrets never do**.

## Managing connections

```
aip integration types
aip integration add <kind> <name> [--repo <project> | --global] [--param key=value]
aip integration list [--repo <project>]
aip integration edit <id> [--param key=value] [--unset key]
aip integration enable <id>
aip integration disable <id>
aip integration check <id>
aip integration remove <id>
aip integration secret set <id> <slot> --stdin < secret.txt
aip integration secret remove <id> <slot>
```

- A new connection is disabled and has no secrets. `enable` is refused until every required secret is set.
- `edit` changes non-secret parameters (the whole result is checked against the kind) and keeps the connection enabled; a secret slot in `--param` is refused with the command that sets a secret. The panel can edit parameters too.
- `check` reaches the other system with the connection and prints `ok, 14 tools` or `failed: <code>`; `aip integration list` shows the time and the result of the last check, which survives a restart. Only an enabled connection with its secrets is checked, and only a kind that has a check (`service-registry`). Results carry a fixed code, never a response text or a secret.
- A secret is read from stdin only (up to 16 KiB); there is no `--value`, so it never lands in the shell history or in `ps`. Errors never repeat the input.
- Removing a secret of an enabled connection disables it first. `remove` deletes the connection and its secrets; repeat it if it was cut short.
- A project that has a connection cannot be removed from the daemon; moving a project keeps its connections.
- Secret commands exist only in the CLI: they are not MCP tools and not in the web panel. The panel lists connections and edits their non-secret parameters; it does not create, enable or remove them.

## Service registry

The kind `service-registry` connects `aip` to a service registry: a server that keeps the specifications, decisions and dependencies of your projects and serves them over MCP at `<url>/api/mcp`.

| | |
|---|---|
| parameter `url` | `https://registry.example.com`: a host with an optional port, no credentials, path, query or fragment |
| secret `token` | the token of the registry (`svcp_…`) |

```
aip integration add service-registry main --global --param url=https://registry.example.com
aip integration secret set <id> token --stdin < token.txt
aip integration enable <id>
aip integration check <id>        # ok, 14 tools
```

Give the specialists the registry as a server of the [catalog](specialists.md#mcp-servers) that goes through the connection:

```yaml
# settings.yaml
mcp_servers:
  registry:
    connection: main
```

```yaml
# specialists/analyst.yaml
name: Analyst
mcp_servers: [registry]
prompt: >
  Start with list_specs, list_adrs and get_dependencies of the project, then answer: %s
```

- A specialist never sees the token. The agent gets a small bridge process instead of a registry address: the bridge passes each message to the daemon, and the daemon sends it to the registry with the token from the secret storage. Neither the token nor the address of the registry is in the files of the attempt, its arguments, its environment or its log.
- The connection is found by name for the project of the run: the connection of the project first, then the shared one. If there is none, or it is disabled, or has no token, the step does not start and says which server and connection to fix. Switching the connection off during a step makes the next calls of the agent fail with `connection_disabled`; the step goes on.
- A failure of the registry reaches the agent as an error with a fixed code: `unreachable`, `timeout` (a request lasts at most 120 s), `unauthorized`, `protocol` or `too_large` (an answer above 4 MiB). It does not end the step.
- Requests follow [`network.proxy`](network.md), otherwise `HTTPS_PROXY`/`HTTP_PROXY` of the daemon unless `NO_PROXY` names the registry; a change of `network.proxy` applies at once. Only proxies that tunnel with HTTP `CONNECT` work; SOCKS gives `unreachable`.
- Publish skills and specifications to the registry with the registry's own tools (Git sources, documentation collection); `aip` only reads from it.

## Where secrets are kept

| Backend | When | Notes |
|---|---|---|
| `keyring` (default on macOS and Linux) | a desktop session | macOS Keychain through `security`, Linux Secret Service through `secret-tool`; the value goes through stdin, never through arguments |
| `file` | headless Linux, servers | an encrypted file under the state directory, with a key that lives **outside** it |

Choose a backend with `AIP_SECRETS_BACKEND=keyring|file`. There is no fallback: if the chosen backend is unavailable, secret commands fail and nothing is written in plain text. The backend is pinned on the first write; selecting another one later is refused until you return to the pinned one.

### Headless mode

Generate a 32-byte key (hex or base64) and keep it where only the supervisor can read it, never next to `~/.local/state/aip`:

```
umask 077
openssl rand -hex 32 > /etc/aip/secrets.key
AIP_SECRETS_BACKEND=file AIP_SECRETS_KEY_FILE=/etc/aip/secrets.key aip daemon start
```

The key file must be a regular file, owned by the user running the daemon, with no access for group or others; otherwise it is refused.

A supervisor can instead pass the key through an inherited descriptor: `AIP_SECRETS_KEY_FD=<n>`. The key is passed by path or descriptor, never as a value in an argument or in the environment.

Values are encrypted with an authenticated cipher and written atomically. A wrong key or a damaged file is an error, not an empty store.

### Threat model and backup

- Protected: secrets against reading the SQLite database, backups of the state directory, logs, the CLI output and IPC responses.
- Not protected: a process running as the same user that can read the key file or the unlocked keyring.
- Back up the key separately from the state directory. Without the key the encrypted secrets cannot be read, and you set them again; with both in one place the encryption gives nothing.

## Entry and exit points of adapters

A future adapter for a concrete system follows this template; none is built in yet.

- **Input**: the adapter hands raw bytes and metadata to the daemon with the id of a verifier registered at startup. The daemon checks the size and the deadline before decoding, verifies the signature or token on the raw body, checks that the connection is enabled, has its secrets and belongs to the project in question, and allows only a fixed list of operations.
- **Idempotency**: every event is claimed durably by `(connection, external event id)`, so a repeat after a restart changes nothing.
- **Operations** go through the same services and state machine as the CLI; an adapter never touches the tables of other features.
- **Output**: a bounded call with its own timeout and idempotency key; the result is a safe message without secrets, and waiting for the network never blocks the run queue.
- **Network**: a built-in adapter opens a listener or an outgoing connection only when a specific change adds it.
