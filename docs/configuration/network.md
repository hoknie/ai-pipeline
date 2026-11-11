# Network check

A VPN such as NetBird can have several exit points. When one drops or switches, agents get `Connection error` and the step fails through no fault of the specialist. The network check lets the daemon notice this and wait instead.

## `network`

```yaml
network:
  enabled: true
  interfaces: [wt0]                           # NetBird; each must exist and have an address
  targets:
    - https://api.anthropic.com               # GET: 403, 407 and 5xx count as unreachable
    - 10.0.0.5:443                            # host:port: a TCP connection
  proxy: http://user:secret@127.0.0.1:3128    # optional
  interval: 30                                # seconds between checks, 5..3600
  timeout: 5                                  # seconds per probe, 1..60
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Turns the check on. With `false` the daemon runs no probes |
| `targets` | `["https://api.anthropic.com"]` | `host:port` or an `http(s)://` URL |
| `interfaces` | none | Network interfaces that must exist and have a non-loopback address |
| `proxy` | none | An `http://` or `https://` proxy |
| `interval` | `30` | Seconds between checks; while the network is down, `min(interval, 5)` |
| `timeout` | `5` | Seconds a probe may take |

The section is set in the shared `settings.yaml` only. In a project `aip/settings.yaml` it is a validation error (`swarm.network`). The daemon rereads it before every check, so a change takes effect without a restart.

## What the check does

The network is `down` if any interface is missing or any target is unreachable, otherwise `up` (`off` when the check is disabled). The state changes after the first failed or successful check. A URL target is reachable on any answer except `403`, `407` and `5xx`; no keys or authorization headers are sent.

Probes go through the `proxy` with `CONNECT`; HTTPS targets are requested over the tunnel.

Without `proxy`, the probe uses `HTTPS_PROXY` (for `https://` URLs and `host:port`) or `HTTP_PROXY` (for `http://` URLs) of the daemon environment, as agents and `curl` do, unless `NO_PROXY` lists the target (`*`, a domain with its subdomains, `host:port`).

`timeout` is one limit for the whole probe of a target.

While the network is `down`:

- no agent starts in any run: the groups wait in `queued` with the reason `network`;
- agents that are already running are not interrupted;
- command actions are not held;
- when the network is back, the groups start by themselves within seconds.

Before an agent starts, the daemon checks the network again if the last check is older than 10 seconds, so a runtime switch inside a step does not start into a dead network.

## Network failures

An attempt that ends without a report is a network failure (`network: <problem>`) when the network is `down` right after it, or when `claude` reports an API connection error.

Such a failure does not switch the runtime of an `on_error` chain and does not count as a rejection. The group waits 30 seconds and retries the same step, continuing the session. After 5 network failures of a step in a row the group fails.

This also works with the check disabled, for `claude` errors.

## Proxy for agents

If `proxy` is set, agents (steps and run naming) get `HTTPS_PROXY` and `HTTP_PROXY` with its value, also with `enabled: false`. A variable from [`runtimes.<runtime>.env`](runtimes.md#runtimes) wins. The state of the network, without the login and password of the proxy, is shown in the [panel](../web/settings.md#system).
