# Providers in the panel

The tabs "Providers" and "Roles" of the [swarm window](swarm.md) (`Ctrl+O`, `#providers`) show and edits the [providers and roles](../configuration/providers.md): who runs the models, which model each role gets from each provider, and where a task may go.

## Providers tab

The tab is a list on the left (with "Create provider" and a search) and the form of the open provider on the right; with no provider open the right part shows the matrix. A row has the name, the slug, the level (shared or project, with "overrides shared" when a project file replaces a shared one), the runtime of the active access and the status.

- The status is "Available" or "Unavailable" with the reasons in words: the access is turned off, its runtime is disabled in the settings, the command is not found, the key variable is not set, or the access is "API — soon".
- A provider in a usage limit shows "Limit" with a countdown to its end; after the end the mark disappears.
- Disabled providers are dimmed. A configuration that cannot be assembled shows its errors above the list.
- `j` and `k` move through the list, `Enter` opens the form. With "All projects" the list shows each shared provider once and each project's own providers as separate rows with the project mark; the matrix and "Roles" show the shared level only, with a hint to choose a project.
- The data are read again on opening, when the window gets focus and on run events, at most once in 5 seconds.

## Matrix

The matrix has a row for each role and a column for each enabled provider ("Show disabled" adds the rest). A cell holds the model of the role at that provider. An empty cell means the role does not run there. A cell with an access that overrides the shared model has a mark.

- A click on a cell opens the model picker: the models of the runtime of the access, or a typed id when the catalog has no list.
- "…" in a cell sets `variant` and `reasoning_effort`; it is shown for `opencode` only.
- A write error (the file changed meanwhile) stays at the cell.

## Roles tab

The list of roles is on the left, the open role on the right with "Models of the role": its model at each provider, edited in place like a cell of the matrix. You can add a role (the slug comes from the name), rename it and move it up or down (`Alt+↑`, `Alt+↓`). The level, "Shared" by default, is chosen in the project area; the shared area writes the shared level only.

Deleting a role asks for confirmation and offers "Clear cells and delete": the cells of the role are cleared one by one, then the role is removed. The first error stops the process and is shown in the dialog.

## Provider form

"New provider" and a provider row open the form at `#providers/new` and `#providers/<slug>`.

- A new provider goes through the steps "Name", "Access" and "Models". An existing one shows all sections on one page; its slug and level are read-only.
- Access is "CLI" (the runtime and, for some runtimes, the model prefix or the command). "API" is not available yet. The order of accesses is the order of trying.
- "Own API address for the CLI" is off by default. Turn it on only when the CLI reaches the model through an address of its own (a proxy or a compatible API): then the address and the key variable are required. `opencode` has no such switch.
- The form takes **names of environment variables** only. It has no field for a secret value and never stores or shows one.
- The daemon's errors show at the field, and the form goes to its step.
- "Delete" removes the file; if a chain still names the provider, the form lists the references and keeps the file. Switch the provider off instead.

### Presets

The first step offers presets, all editable:

| Preset | What it fills |
|---|---|
| Anthropic | the `claude` runtime; the models `opus`, `sonnet`, `haiku` for the roles `think`, `code`, `light` that exist |
| Z.ai GLM Coding Plan | `claude` with the own address `https://api.z.ai/api/anthropic` and the key variable `ZAI_API_KEY`, and `opencode` with the prefix `zai-coding-plan` |
| OpenAI | the `codex` runtime |
| Gemini | `opencode` with the prefix `google` |
| Custom endpoint | a `codex` access with the own address turned on and its fields empty |

## Choosing a provider elsewhere

Every provider field (the task form, the queue item, "Provider" in a run, an element of a chain) is the same combobox: search by name and slug, the status, disabled ones last and not selectable, and "Create provider…" that opens the form in a dialog and selects the new one. The run list has a "Provider" filter.

## Shared providers

In the group "Swarm" of the "Shared" settings the tabs "Providers" and "Roles" show the shared level only: the providers with a file in the shared `providers/` directory and the shared roles, with their values even when a project overrides them. The form has no level choice, writes the shared file and says the change applies in every repository.
