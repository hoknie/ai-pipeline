# Sourced by scripts/changelog.sh and scripts/release.sh: the repository root and the version.
# shellcheck shell=bash

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$PWD"
OUT="${OUT:-$ROOT/dist}"
RELEASE="${RELEASE:-$OUT/release}"
PACKAGE_FILE="$ROOT/package.json"
PLUGIN_FILE="$ROOT/integrations/claude-code/.claude-plugin/plugin.json"

VERSION="${VERSION:-$(node -p 'require(process.argv[1]).version' "$PACKAGE_FILE")}"
[ -n "$VERSION" ] || { echo "release: cannot read the version out of package.json" >&2; exit 2; }
export VERSION

die() { printf 'release: %s\n' "$*" >&2; exit 1; }
