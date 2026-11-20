# Server mode

One shared daemon on a server can serve several people over the network: the panel sits behind a reverse proxy, and each person works through the panel, `aip` on their own machine, or `aip mcp`.

## `server`

```yaml
server:
  enabled: true
  listen: 127.0.0.1:7341
  public_url: https://aip.example.com
  trusted_proxies: [10.0.0.5]
  session_ttl: 12h
  token_max_ttl: 90d
  audit_retention: 365d
  commit_trailer: aip <aip@example.com>
  default_role: developer
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Turns server mode on; without it everything works as a local daemon |
| `listen` | `127.0.0.1:7341` | `<address>:<port>` the panel listens on; a non-loopback address is allowed |
| `public_url` | none | The external address, `http` or `https`, no path. Required when `enabled` is `true` |
| `trusted_proxies` | none | IP addresses of reverse proxies whose `X-Forwarded-For`, `-Proto` and `-Host` headers are trusted; from other addresses they are ignored |
| `session_ttl` | `12h` | Lifetime of a panel session, `<n>h` or `<n>d` |
| `token_max_ttl` | `90d` | The longest lifetime of a personal token, `<n>d` |
| `audit_retention` | `365d` | How long the [audit journal](#audit-journal) keeps an entry, `<n>d` |
| `commit_trailer` | none | `Name <email>` added to the message of a delivery commit as `Co-Authored-By`, see [authors](#authors-and-commits) |
| `default_role` | none | `admin`, `developer` or `viewer`: the role of a user without the attribute `role`, see [access.md](access.md) |
| `sso` | none | Sign-in through a corporate provider: see [sso.md](sso.md) (OpenID Connect) and [sso-saml.md](sso-saml.md) (SAML 2.0) |

The section is set in the shared `settings.yaml` only; in a project `aip/settings.yaml` it is a validation error (`swarm.server`). In server mode `web.auth: none` and `web.autostart: false` are validation errors. A change takes effect after the daemon restarts.

## Setting up

1. Run the daemon on the server as its own system user (`aip daemon` under systemd). Every agent works with the credentials of that user; anyone who can reach the daemon socket there acts as the system.
   ```ini
   [Service]
   User=aip
   ExecStart=/usr/bin/aip daemon
   Restart=on-failure
   ```

2. Put a reverse proxy in front of `listen`. It terminates TLS and passes `Host`, `X-Forwarded-Proto` and `X-Forwarded-For`; list its address in `trusted_proxies`.

   ```nginx
   server {
     listen 443 ssl;
     server_name aip.example.com;
     location / {
       proxy_pass http://127.0.0.1:7341;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header X-Forwarded-For $remote_addr;
       proxy_buffering off;   # the event stream
     }
   }
   ```

3. Make the first administrator on the server and open the link in a browser:

   ```
   aip server login-link --email admin@example.com --admin
   ```

   A link works once and for 15 minutes (`--ttl` up to 7 days). It needs no external login provider.

In server mode the shared panel token and `AIP_WEB_TOKEN` do not work: a page without a session goes to the login page, and the API answers 401. `Host` must be the host of `public_url`, and a request that changes state from a browser must carry its `Origin`.

## People

- The panel menu has the user's tokens, «Users» for an administrator, and «Sign out». A session lasts `session_ttl` from the login.
- `aip server users` lists users; `disable` and `enable <email>` switch one off and on (the sessions and tokens stop within 10 seconds); `set <email> role=admin team=core` changes the attributes of a local user. The last active administrator cannot be removed.
- Users are never deleted, so their runs keep an author.

## Authors and commits

- A task belongs to the person who added it, and its run to the same person. A task a specialist adds takes the author of its run.
- Restarting, pausing or returning a run, and editing a task (also by someone else), leave the author as it is. Tasks added by the system, and everything from before server mode, have no author.
- The panel, `aip queue`, `aip status` and `aip run show` show the author. `--json` and the API carry `author` as `{ id, email, name, disabled }`.
- The delivery commit of the branch `aip/<run-id>` is by the author of the run: `Author` is their name and email, `Committer` stays the git identity of the daemon's OS user. The result is one commit on the base of the run. A commit made by `aip run apply --mode commit` on a developer's machine has that developer's git identity.
- A run without an author gets the git identity of the daemon for both. A local daemon changes nothing in its commits.
- With `commit_trailer` the message ends with `Co-Authored-By: <value>` after an empty line, once.

## Audit journal

Server mode keeps a journal of what people do. An entry has who, when, the action, the project and resource, the outcome (`ok`, `denied`, `failed`) and the details.

- Every call that changes something is written: runs, queue, settings, projects, tokens, users. Reads and the tools of specialists are not.
- Actions are named `run.cancel`, `config.write` (a project), `config.global.write` (shared settings), `project.add`, `stats.clear` and so on.
- Sign-ins are written too: `auth.login`, `auth.logout`, `auth.login_failed` with the reason and the address of the client, `token.create`, `token.revoke`, `login_link.create`, `user.disable`.
- Details never hold tokens, codes or secrets; the text of an answer is cut to 2000 characters. A failed write of an entry never undoes the action; it goes to the daemon log.

Administrators read it, newest first (by default the last 7 days, at most 200 entries):

```
aip audit [--user <email>] [--repo <slug|path>] [--action <prefix>] [--since 1d] [--limit 50] [--json]
```

The panel has the same under «Journal» in the account menu, and `GET /api/audit` takes the same filters. Anyone else gets 403. Entries older than `audit_retention` are deleted once a day; entries cannot be edited or deleted by hand.

## From your machine

```
aip login https://aip.example.com     # --no-browser prints the link
aip whoami
aip token create ci --ttl 30d         # the value is shown once
aip token list
aip token revoke ci
aip logout
```

`aip login` saves the server and a token in `remote.json` next to the shared `settings.yaml` (permissions `0600`). After that every command and `aip mcp` works with the server and starts no local daemon; `aip daemon` and `aip web` refuse until `aip logout`. `AIP_SERVER` and `AIP_TOKEN` take precedence over the profile, which suits CI.

A path on your machine is matched to a server project by the `git remote` of that directory; if none matches, name the project with `--repo <slug>`.

## Limits

- What a user may do is decided by the role and the rules of `access.yaml`: see [access.md](access.md). Without a role and without `default_role` a user can do nothing but manage their own tokens; the administrators have `role: admin`.
- Delivery on the server is only a branch: `delivery.mode: worktree` or `commit` is a settings error there, see [delivery](delivery.md#server-mode).
- `shutdown` and the daemon and panel controls are not available over the network without the `daemon.control` right.
