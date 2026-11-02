#!/bin/sh
# Installs aip: a global npm package, then `aip setup` connects it to Claude Code and OpenCode.
#
#   curl -fsSL https://raw.githubusercontent.com/hoknie/ai-pipeline/main/scripts/install.sh | sh
#
# Environment:
#   AIP_VERSION    version to install (default: latest)
#   AIP_PACKAGE    npm package name (default: @hoknie/aip)
#   AIP_NO_SETUP   set to 1 to install only, without `aip setup`
#
# The script never calls sudo. The whole body is inside `main`, which runs on the last line, so a
# download cut in the middle does nothing.

set -eu

main() {
  AIP_PACKAGE="${AIP_PACKAGE:-@hoknie/aip}"
  AIP_VERSION="${AIP_VERSION:-latest}"
  AIP_NO_SETUP="${AIP_NO_SETUP:-}"

  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    red=$(printf '\033[31m'); green=$(printf '\033[32m'); bold=$(printf '\033[1m'); reset=$(printf '\033[0m')
  else
    red=''; green=''; bold=''; reset=''
  fi

  say() { printf '%s\n' "$*"; }
  fail() {
    printf '%sError:%s %s\n' "$red" "$reset" "$1" >&2
    shift
    for line in "$@"; do printf '  %s\n' "$line" >&2; done
    exit 1
  }

  say "${bold}Installing aip${reset}"

  command -v node >/dev/null 2>&1 || fail 'Node.js is not installed. aip needs Node.js 24 or newer.' \
    'Download it from https://nodejs.org or use a version manager: nvm install 24'
  node_version=$(node -p 'process.versions.node')
  node_major=${node_version%%.*}
  case $node_major in
    '' | *[!0-9]*) fail "Could not read the Node.js version (got '$node_version')." ;;
  esac
  [ "$node_major" -ge 24 ] || fail "Node.js $node_version found, but aip needs Node.js 24 or newer." \
    'Update it: nvm install 24, or download it from https://nodejs.org'
  command -v npm >/dev/null 2>&1 || fail 'npm is not installed. It normally comes with Node.js.' \
    'Reinstall Node.js from https://nodejs.org'
  command -v git >/dev/null 2>&1 || fail 'git is not installed. aip needs git 2.20 or newer.' \
    'Install it with your package manager (for example: brew install git, apt install git)'

  # npm writes into $prefix/lib/node_modules and $prefix/bin, so check the nearest existing parent
  # of each (the prefix itself may belong to root while these two belong to the user). No sudo.
  prefix=$(npm prefix -g)
  for target in "$prefix/lib/node_modules" "$prefix/bin"; do
    probe=$target
    while [ ! -e "$probe" ] && [ "$probe" != '/' ] && [ -n "$probe" ]; do probe=${probe%/*}; done
    [ -w "${probe:-/}" ] || fail "npm cannot write to $target, and this script does not use sudo." \
      'Give npm a prefix in your home directory, then run this script again:' \
      '  npm config set prefix ~/.local' \
      '  and add ~/.local/bin to PATH'
  done

  say "Installing $AIP_PACKAGE@$AIP_VERSION with npm..."
  npm install -g "$AIP_PACKAGE@$AIP_VERSION" || fail "npm install -g $AIP_PACKAGE@$AIP_VERSION failed."

  if [ "$AIP_NO_SETUP" = 1 ]; then
    say "${green}Installed.${reset} Skipped the setup of Claude Code and OpenCode (AIP_NO_SETUP=1)."
    say 'Next: aip setup'
    return 0
  fi

  # Prefer the copy just installed over any older `aip` that comes earlier in PATH.
  if [ -x "$prefix/bin/aip" ]; then
    aip_bin="$prefix/bin/aip"
  else
    aip_bin=$(command -v aip 2>/dev/null) || fail 'aip was installed, but it is not in PATH.' \
      "Add $prefix/bin to PATH, open a new shell and run: aip setup"
  fi
  "$aip_bin" setup --yes || fail 'aip setup failed. Fix the problem above and run: aip setup'

  say "${green}Done.${reset} Next: cd <your repository> && aip init"
}

main "$@"
