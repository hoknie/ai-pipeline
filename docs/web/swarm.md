# The swarm window

The "Swarm" section holds everything a run is made of, in one window with five tabs: "Providers", "Roles", "Chains", "Specialists" and "Pipeline". The order follows the links between them: a provider and its roles go into chains or specialists, and the pipelines pick the specialists.

- The strip opens the window for the selected project (or for all projects). Clicking "Swarm" opens the tab you were on last, "Specialists" the first time.
- `Ctrl+O` opens "Providers", `Ctrl+S` "Specialists" and `Ctrl+B` "Pipeline". The command palette has an item for each tab ("Swarm → Roles").
- The same window is the group "Swarm" of the [settings](settings.md#swarm), on both tabs: "Shared" works with the shared files only, "Project" with the selected project.
- With "All projects" the lists group entries by slug with their projects under each row and everything is read only; "Open in project" switches to that project and opens the entry for editing (see [All projects](config.md#all-projects)).
- A tab remembers its last open entry while the page lives. Changing the tab with unsaved edits asks first.
- The addresses of the tabs are `#providers`, `#providers/roles`, `#specialists/chains`, `#specialists` and `#pipelines`, each with `/<entry>`.

## Chains

Choosing a provider in an item of a chain adds a group "Roles of the provider" to the model choice. Each choice shows the role and its current model through the first enabled CLI for the item's runtime. Choosing **Think** saves a reference to that provider's role, not the displayed model ID:

```yaml
name: Thinking
mode: on_error
enabled: true
runtimes:
  - runtime: opencode
    enabled: true
    provider: proxy
    model_role: think
```

New configuration loads follow changes to that role's model. Existing runs keep their configuration snapshot until an explicit configuration refresh. Selecting a model from the catalog or typing its ID instead writes `model: proxy/A` (without `model_role`) and remains fixed, even if a role uses the same ID. Saving, reopening, and moving between YAML and the form preserve this distinction.

Changing the provider clears the selected role and asks you to choose again. An incompatible runtime or a removed role leaves the reference visible with a warning; choose another role or a fixed model to repair it. Shared chains use the shared registry in the editor; project chains use the project's effective registry.

## Where each part is described

- Providers and roles: [providers](providers.md).
- Specialists, chains and pipelines: [config](config.md).
