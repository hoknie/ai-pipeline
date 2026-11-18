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
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Turns server mode on; without it everything works as a local daemon |
| `listen` | `127.0.0.1:7341` | `<address>:<port>` the panel listens on; a non-loopback address is allowed |
| `public_url` | none | The external address, `http` or `https`, no path. Required when `enabled` is `true` |
| `trusted_proxies` | none | IP addresses of reverse proxies whose `X-Forwarded-For`, `-Proto` and `-Host` headers are trusted; from other addresses they are ignored |
| `session_ttl` | `12h` | Lifetime of a panel session, `<n>h` or `<n>d` |
| `token_max_ttl` | `90d` | The longest lifetime of a personal token, `<n>d` |
| `sso` | none | Sign-in through a corporate provider: see [sso.md](sso.md) |

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

- Only administrators change the shared settings, add or move projects, import specialists and clear statistics.
- A user delivers a result only with `delivery.mode: branch`; with `worktree` or `commit` the server answers `access.denied`, because the working tree on the server is shared.
- `shutdown` and the daemon and panel controls are not available over the network.
