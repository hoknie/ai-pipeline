# Providers in the panel

The "Providers" section (`Ctrl+O`, `#providers`) shows and edits the [providers and roles](../configuration/providers.md): who runs the models, which model each role gets from each provider, and where a task may go.

## Providers tab

A row has the name, the slug, the level (shared or project, with "overrides shared" when a project file replaces a shared one), the runtime of the active access and the status.

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

The tab lists the roles of one level, "Shared" by default. You can add a role (the slug comes from the name), rename it and move it up or down (`Alt+↑`, `Alt+↓`).

Deleting a role asks for confirmation and offers "Clear cells and delete": the cells of the role are cleared one by one, then the role is removed. The first error stops the process and is shown in the dialog.

## Provider form

"New provider" and a provider row open the form at `#providers/new` and `#providers/<slug>`.

- A new provider goes through the steps "Name", "Access" and "Models". An existing one shows all sections on one page; its slug and level are read-only.
- Access is "CLI" (the runtime, the command, the base URL and the key variable). "API" is not available yet. The order of accesses is the order of trying.
- The form takes **names of environment variables** only. It has no field for a secret value and never stores or shows one.
- The daemon's errors show at the field, and the form goes to its step.
- "Delete" removes the file; if a chain still names the provider, the form lists the references and keeps the file. Switch the provider off instead.

### Presets

The first step offers presets, all editable:

| Preset | What it fills |
|---|---|
| Anthropic | the `claude` runtime; the models `opus`, `sonnet`, `haiku` for the roles `think`, `code`, `light` that exist |
| Z.ai GLM Coding Plan | `claude` with `https://api.z.ai/api/anthropic` and the key variable `ZAI_API_KEY`, and `opencode` with the prefix `zai-coding-plan` |
| OpenAI | the `codex` runtime |
| Gemini | `opencode` with the prefix `google` |
| Custom endpoint | an empty `codex` access with an endpoint |

## Choosing a provider elsewhere

Every provider field (the task form, the queue item, "Provider" in a run, an element of a chain) is the same combobox: search by name and slug, the status, disabled ones last and not selectable, and "Create provider…" that opens the form in a dialog and selects the new one. The run list has a "Provider" filter.
