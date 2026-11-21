# Providers and roles

A provider is an account you pay for or a gateway you use, such as Anthropic or Z.ai. Each is one file, `providers/<slug>.yaml`, in the shared `~/.config/aip/` or in a project `aip/` directory (a project file replaces the shared one with the same slug as a whole).

The file name is the `slug`: lowercase letters, digits and `-`, up to 32 characters, starting with a letter. The slug is also the key of the [usage limit](../usage/queue.md#usage-limit) of the account.

Every `provider` of a [runtime chain](runtimes.md#runtime-chains) item, every `--provider` of a task and every run provider must name a provider defined here. An unknown one is refused with the list of the known ones, `anthropic (Anthropic), zai (Z.ai)`, or `known: none`.

```yaml
name: Z.ai
enabled: true            # false: the provider is known but cannot be chosen for a task or a run
access:                  # routes to the provider, in the order of preference
  - kind: cli
    runtime: opencode
    model_prefix: gproxy/glmcode
models:                  # the model of each role
  think: GLM-5.3
  code: GLM-5.3-Flash
```

## Access

`access` is a non-empty list. The effective route is the first one that is available.

- **`kind: cli`** goes through an agent CLI:
  - `runtime`: `claude`, `opencode`, `agy`, `codex`, `kilo`, `cline` or `copilot`.
  - `model_prefix` (`opencode` and `kilo` only): the part of the model ID the CLI needs before the model, such as `gproxy/glmcode`. The full ID is `<model_prefix>/<model>`; for `opencode` it must read `provider/model`.
  - `endpoint` (`claude`, `codex`, `kilo`, `cline`, `copilot`): `base_url` and `key_env`, the **name** of an environment variable that holds the key. A key is never written in a file.
  - `command` and `args`: replace `runtimes.<runtime>.command` and `args` for this route. Shared level only.
  - `models`: replaces the models of some roles for this route.
  - `enabled`: `false` switches the route off.
- **`kind: api`** is a place for a direct channel (`enabled`, `endpoint`, `models`). It is not implemented: the route is always unavailable.

## Roles

`roles` in `settings.yaml` is the list of the roles of a model: slug → `name`. There are no built-in roles. A project adds roles to the shared ones or renames them by slug.

```yaml
roles:
  think: { name: Think }
  code: { name: Code }
  light: { name: Light }
```

A model is `<model>` or `{ model, variant, reasoning_effort }`; the options need a provider with an `opencode` route. A role the provider has no model for is an empty cell: it is not an error, `aip config check` warns about it. A model of an unknown role is an error.

## Default provider

`default_provider: <slug>` in `settings.yaml` names the provider a new task goes to when none is chosen. There is one value per level: the shared `settings.yaml` sets it for every project, a project `settings.yaml` replaces it. The shared value must name a shared provider; the project value any provider of the project. An unknown slug is an error at `swarm.default_provider`.

```yaml
default_provider: anthropic
```

A switched-off default provider is not used: the task stays without a provider, and `aip config check` warns. `--no-provider` (MCP and IPC `provider: null`) puts a task on no provider even when a default is set. A provider that is the default cannot be deleted; make another one the default first.

## Availability

`aip provider list` and `aip provider show <slug>` show the status of a provider: `disabled`, `unavailable` or `available`. A `cli` route is available when its runtime is [switched on](runtimes.md#runtimes) (also by `AIP_<RUNTIME>_BIN`), its command is found, and the variable named in `endpoint.key_env` is set in the daemon's environment or in `runtimes.<runtime>.env`.

The command is chosen as for a start of the agent: `AIP_<RUNTIME>_BIN`, then the `command` of the route, then `runtimes.<runtime>.command`, then the runtime's name.

A route that is not available lists why, for example `variable CORP_KEY is not set`. Nothing is started and no value of a variable is shown.

```
aip provider list
aip provider show zai
aip provider show zai --json
```

`aip config check` prints the roles, the providers with their routes and the warnings about empty cells. The panel reads the same data (`config_providers`, `provider_models`): the models of a route for autocomplete come from `opencode models` (filtered by `model_prefix`) and the built-in list of Claude; for the other CLIs the model is typed by hand.

Editing a provider in the panel or by `config_write` follows the rules of the other files. A provider that an item of a chain names cannot be deleted.
