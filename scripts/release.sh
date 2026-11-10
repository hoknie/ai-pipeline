#!/usr/bin/env bash
# What a release needs besides the gate.
#   scripts/release.sh version            the version in package.json
#   scripts/release.sh check-tag vX.Y.Z   the tag names that version, and the plugin manifest agrees
#   scripts/release.sh pack               the npm tarball and SHA256SUMS in dist/release
#   scripts/release.sh notes              the CHANGELOG.md section of this version, else one written from git

set -euo pipefail
# shellcheck source=scripts/release-common.sh
source "$(dirname "$0")/release-common.sh"

sum() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

check_tag() {
    local tag="${1:-}" plugin
    [ -n "$tag" ] || die "usage: scripts/release.sh check-tag vX.Y.Z"
    tag="${tag#refs/tags/}"
    if [ "$tag" != "v$VERSION" ]; then
        echo "release: the tag is $tag and package.json says $VERSION." >&2
        echo "release: run 'just release ${tag#v}', commit the result and tag that commit." >&2
        exit 1
    fi
    plugin="$(node -p 'require(process.argv[1]).version' "$PLUGIN_FILE")"
    [ "$plugin" = "$VERSION" ] || die "the plugin manifest says $plugin and package.json says $VERSION"
    echo "$VERSION"
}

pack() {
    rm -rf "$RELEASE"
    mkdir -p "$RELEASE"
    local tarball
    tarball="$(npm pack --silent --pack-destination "$RELEASE" | tail -n 1)"
    [ -f "$RELEASE/$tarball" ] || die "npm pack wrote no $tarball"
    tar -tzf "$RELEASE/$tarball" | grep -x 'package/dist/cli/main.js' >/dev/null || die "$tarball does not hold dist/cli/main.js"
    (cd "$RELEASE" && sum "$tarball" > SHA256SUMS && sum -c SHA256SUMS >/dev/null && cat SHA256SUMS)
}

notes() {
    local section=""
    if [ -f "$ROOT/CHANGELOG.md" ]; then
        section="$(awk -v want="## [$VERSION]" '
            /^## / { if (inside) exit; if (index($0, want) == 1) { inside = 1; next } }
            inside { print }
        ' "$ROOT/CHANGELOG.md")"
    fi
    if [ -z "${section//[[:space:]]/}" ]; then
        section="$("$ROOT/scripts/changelog.sh" section "$VERSION" | tail -n +2)"
    fi
    printf '%s\n' "$section" | sed '/./,$!d'
}

case "${1:-}" in
version)   echo "$VERSION" ;;
check-tag) check_tag "${2:-}" ;;
pack)      pack ;;
notes)     notes ;;
*) echo "usage: scripts/release.sh {version|check-tag vX.Y.Z|pack|notes}" >&2; exit 2 ;;
esac
