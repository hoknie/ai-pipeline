# Installation

How to install `aip`, connect it to Claude Code and OpenCode, update and remove it.

## One command

```sh
curl -fsSL https://raw.githubusercontent.com/hoknie/ai-pipeline/main/scripts/install.sh | sh
```

The script checks Node.js 24 or newer, npm and git, installs the `@hoknie/aip` package globally and runs `aip setup --yes`. It never uses `sudo` and does not install Node.js for you.

To read the script before running it:

```sh
curl -fsSL https://raw.githubusercontent.com/hoknie/ai-pipeline/main/scripts/install.sh -o install.sh
less install.sh
sh install.sh
```

Variables for the script:

| Variable | Meaning |
|---|---|
| `AIP_VERSION` | The version to install. Default: `latest` |
| `AIP_PACKAGE` | The npm package name. Default: `@hoknie/aip` |
| `AIP_NO_SETUP=1` | Install the package and skip `aip setup` |

## With npx

```sh
npx @hoknie/aip@latest setup
```

`npx` only runs the command. `aip setup` first installs the same version globally (it asks first; `--yes` skips the question) and then connects the installed copy, so Claude Code and OpenCode never point into a temporary cache.

## From source

```sh
git clone https://github.com/hoknie/ai-pipeline.git
cd ai-pipeline
npm ci
npm run build
npm link
aip setup
```

## What `aip setup` does

For every host it finds on the machine, `aip setup`:

- Claude Code: registers the MCP server `aip` for your user (`claude mcp add --scope user aip -- aip mcp`) and installs the `aip` plugin from the marketplace in the package (`claude plugin install aip@aip`);
- OpenCode: adds the server `aip` under `mcp` in `~/.config/opencode/opencode.json` and keeps every other key.

A host that is not installed is skipped. Running it again changes nothing. If `aip` is already registered with another command, it is left alone until you pass `--force`.

| Flag | Meaning |
|---|---|
| `--yes` | Ask nothing |
| `--dry-run` | Print what would be done and change nothing |
| `--force` | Replace an `aip` setting that differs |
| `--no-claude` | Skip Claude Code |
| `--no-opencode` | Skip OpenCode |
| `--no-plugin` | Do not install the Claude Code plugin |

If your OpenCode configuration is `opencode.jsonc` (with comments) or is not valid JSON, `aip setup` does not touch it and prints the lines to add by hand.

To install the plugin without npm, run this in Claude Code: `/plugin marketplace add hoknie/ai-pipeline`, then `/plugin install aip@aip`.

## Update

Run the install script again, or:

```sh
npm install -g @hoknie/aip@latest
aip setup
```

A running daemon of an older build is replaced when it has nothing to do.

## Remove

```sh
claude plugin uninstall aip@aip
claude mcp remove --scope user aip
npm rm -g @hoknie/aip
```

For OpenCode, delete the `aip` entry under `mcp` in `opencode.json`.

## Problems

**`aip: command not found` after installing.** Add the npm global bin directory to `PATH`. It is `$(npm prefix -g)/bin`. With nvm, open a new shell. If Claude Code starts without your shell profile and cannot find `aip`, set the plugin option `aipCommand` to `["node", "/full/path/to/dist/cli/main.js"]`. `aip setup` already writes absolute paths for the MCP server when `aip` is not in `PATH`.

**`EACCES` when installing globally.** npm cannot write to its global directory. Do not use `sudo`; give npm a prefix in your home directory and put its `bin` into `PATH`:

```sh
npm config set prefix ~/.local
export PATH="$HOME/.local/bin:$PATH"
```

**Node.js is too old.** Install version 24 or newer from [nodejs.org](https://nodejs.org) or with `nvm install 24`.
