# The swarm window

The "Swarm" section holds everything a run is made of, in one window with five tabs: "Providers", "Roles", "Chains", "Specialists" and "Pipeline". The order follows the links between them: a provider and its roles go into chains or specialists, and the pipelines pick the specialists.

- The strip opens the window for the selected project (or for all projects). Clicking "Swarm" opens the tab you were on last, "Specialists" the first time.
- `Ctrl+O` opens "Providers", `Ctrl+S` "Specialists" and `Ctrl+B` "Pipeline". The command palette has an item for each tab ("Swarm → Roles").
- The same window is the group "Swarm" of the [settings](settings.md#swarm), on both tabs: "Shared" works with the shared files only, "Project" with the selected project.
- A tab remembers its last open entry while the page lives. Changing the tab with unsaved edits asks first.
- The addresses of the tabs are `#providers`, `#providers/roles`, `#specialists/chains`, `#specialists` and `#pipelines`, each with `/<entry>`.

## Where a provider is used

The page of a provider ends with "Where it is used": the chains that name it (with the item numbers), the specialists that run those chains and the pipelines whose steps or split run those specialists. Each line is a link to its tab. A provider nobody uses says so and links to "Chains".

## Chains

Choosing a provider in an item of a chain adds its roles to the model choice: a group "Roles of the provider" with each role's model through the CLI of the item. Choosing one writes the model id; the chain does not follow later changes of the role.

## Where each part is described

- Providers and roles: [providers](providers.md).
- Specialists, chains and pipelines: [config](config.md).
