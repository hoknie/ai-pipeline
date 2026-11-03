#!/usr/bin/env bash
# CHANGELOG.md, written from the commits between v* tags (Conventional Commits).
#   scripts/changelog.sh rebuild                    CHANGELOG.md anew: Unreleased and one section per tag
#   scripts/changelog.sh section [X.Y.Z]          one section: the tag's commits, or the commits since the last tag
#   scripts/changelog.sh next [auto|patch|minor|major]  the version the next release takes
#   scripts/changelog.sh release [auto|patch|minor|major|X.Y.Z]
#                                                   bumps the version in package.json, package-lock.json and
#                                                   the plugin manifest unless package.json is already past
#                                                   the last tag (or there is no tag yet), then writes that
#                                                   version's section into CHANGELOG.md
# Merges, "chore: bump version" and repeated subjects are left out. A "type!:" subject or a
# "BREAKING CHANGE:" footer is breaking: while the major is 0 it bumps the minor, a feat bumps the patch.

set -euo pipefail
# shellcheck source=scripts/release-common.sh
source "$(dirname "$0")/release-common.sh"

CHANGELOG="$ROOT/CHANGELOG.md"

repository() {
    if [ -n "${CHANGELOG_REPOSITORY:-}" ]; then echo "$CHANGELOG_REPOSITORY"; return; fi
    if [ -n "${GITHUB_REPOSITORY:-}" ]; then echo "${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY"; return; fi
    local origin; origin="$(git remote get-url origin 2>/dev/null || true)"
    case "$origin" in
    git@github.com:*) origin="https://github.com/${origin#git@github.com:}" ;;
    https://github.com/*) ;;
    *) return 0 ;;
    esac
    echo "${origin%.git}"
}
REPOSITORY="$(repository)"

tag_exists() { git rev-parse -q --verify "refs/tags/$1" >/dev/null; }

# The newest v* tag reachable from <ref>, or nothing.
tag_before() { git describe --tags --abbrev=0 --match 'v[0-9]*' "$1" 2>/dev/null || true; }

# entries <git log range...>: the grouped list, with nothing when the range holds no change.
entries() {
    git log --format='%H%x1f%s%x1f%b%x1e' "$@" | awk -v repository="$REPOSITORY" '
        BEGIN {
            RS = "\036"; FS = "\037"
            count = split("breaking features fixes performance changes documentation build dependencies tests other", order, " ")
            title["breaking"] = "Breaking changes"; title["features"] = "Features"; title["fixes"] = "Fixes"
            title["performance"] = "Performance"; title["changes"] = "Changes"; title["documentation"] = "Documentation"
            title["build"] = "Build and CI"; title["dependencies"] = "Dependencies"; title["tests"] = "Tests"
            title["other"] = "Other"
        }
        {
            hash = $1; sub(/^[\n]+/, "", hash)
            subject = $2; body = $3
            if (hash == "" || subject == "") next
            if (subject ~ /^Merge / || subject ~ /^chore(\(release\))?: (bump version|release)/) next
            key = tolower(subject)
            if (key in seen) next
            seen[key] = 1

            group = "other"; text = subject; scope = ""
            colon = index(subject, ": ")
            if (colon > 0) {
                head = substr(subject, 1, colon - 1)
                if (head ~ /^[A-Za-z]+(\([^()]*\))?!?$/) {
                    text = substr(subject, colon + 2)
                    breaking = (head ~ /!$/); sub(/!$/, "", head)
                    type = head
                    open = index(head, "(")
                    if (open > 0) { scope = substr(head, open + 1, length(head) - open - 1); type = substr(head, 1, open - 1) }
                    type = tolower(type)
                    if (type == "feat") group = "features"
                    else if (type == "fix") group = "fixes"
                    else if (type == "perf") group = "performance"
                    else if (type == "refactor") group = "changes"
                    else if (type == "docs") group = "documentation"
                    else if (type == "build" || type == "ci") group = (scope ~ /^deps/) ? "dependencies" : "build"
                    else if (type == "test") group = "tests"
                    if (breaking) group = "breaking"
                }
            }
            if (index(body, "BREAKING CHANGE:") || index(body, "BREAKING-CHANGE:")) group = "breaking"

            text = toupper(substr(text, 1, 1)) substr(text, 2)
            if (scope != "" && scope !~ /^deps/) text = "**" scope ":** " text
            if (repository != "") text = text " ([" substr(hash, 1, 7) "](" repository "/commit/" hash "))"
            else text = text " (" substr(hash, 1, 7) ")"
            lines[group] = lines[group] "- " text "\n"
        }
        END {
            first = 1
            for (i = 1; i <= count; i++) {
                if (!(order[i] in lines)) continue
                if (!first) printf "\n"
                printf "### %s\n\n%s", title[order[i]], lines[order[i]]
                first = 0
            }
        }'
}

# section <heading> <previous tag or nothing> <end ref> <date>
section() {
    local heading="$1" previous="$2" end="$3" date="$4" range body
    if [ -n "$previous" ]; then range="$previous..$end"; else range="$end"; fi
    body="$(entries "$range")"
    if [ "$heading" = "Unreleased" ]; then echo "## [Unreleased]"; else echo "## [$heading] - $date"; fi
    echo
    if [ -n "$body" ]; then echo "$body"; else echo "No notable changes."; fi
    if [ -n "$REPOSITORY" ] && [ -n "$previous" ]; then
        local to="v$heading"; [ "$heading" = "Unreleased" ] && to="HEAD"
        echo
        echo "[Full diff]($REPOSITORY/compare/$previous...$to)"
    fi
}

# section_of <X.Y.Z>: the tag's own commits when the tag exists, the commits since the last tag otherwise.
section_of() {
    local version="$1"
    if tag_exists "v$version"; then
        section "$version" "$(tag_before "v$version^")" "v$version" "$(git log -1 --format=%cs "v$version")"
    else
        section "$version" "$(tag_before HEAD)" HEAD "$(date +%Y-%m-%d)"
    fi
}

header() {
    cat <<'EOF'
# Changelog

Every notable change of aip. Sections are written by `scripts/changelog.sh` from the
Conventional Commits between release tags; the release on GitHub carries the section of its tag.
The versions follow [Semantic Versioning](https://semver.org/).
EOF
}

rebuild() {
    local tags=() previous="" tag
    while IFS= read -r tag; do tags+=("$tag"); done < <(git tag -l 'v[0-9]*' --merged HEAD --sort=-version:refname)
    {
        header
        local last="${tags[0]:-}" unreleased
        if [ -n "$last" ]; then unreleased="$(entries "$last..HEAD")"; else unreleased="$(entries HEAD)"; fi
        if [ -n "$unreleased" ]; then echo; section Unreleased "$last" HEAD ""; fi
        local i
        for ((i = 0; i < ${#tags[@]}; i++)); do
            tag="${tags[$i]}"
            previous="${tags[$((i + 1))]:-}"
            echo
            section "${tag#v}" "$previous" "$tag" "$(git log -1 --format=%cs "$tag")"
        done
    } > "$CHANGELOG"
    echo "changelog: wrote $CHANGELOG with ${#tags[@]} releases" >&2
}

# next <level>: the version after the last tag.
next() {
    local level="${1:-auto}" last major minor patch
    last="$(tag_before HEAD)"
    last="${last#v}"; last="${last%%-*}"; last="${last:-0.0.0}"
    IFS=. read -r major minor patch <<<"$last"
    if [ "$level" = "auto" ]; then
        local range; range="$(tag_before HEAD)"; range="${range:+$range..}HEAD"
        local body; body="$(entries "$range")"
        [ -n "$body" ] || die "there is no change since the last tag"
        if grep -q '^### Breaking changes' <<<"$body"; then level="major"
        elif grep -q '^### Features' <<<"$body"; then level="minor"
        else level="patch"
        fi
        if [ "$major" = 0 ]; then
            case "$level" in major) level="minor" ;; minor) level="patch" ;; esac
        fi
    fi
    case "$level" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "$major.$((minor + 1)).0" ;;
    patch) echo "$major.$minor.$((patch + 1))" ;;
    *) die "level is auto, patch, minor or major, not $level" ;;
    esac
}

set_version() {
    local version="$1"
    (cd "$ROOT" && npm version "$version" --no-git-tag-version --allow-same-version >/dev/null)
    node -e '
        const fs = require("node:fs");
        const [file, version] = process.argv.slice(1);
        const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
        manifest.version = version;
        fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
    ' "$PLUGIN_FILE" "$version"
}

# write_section <X.Y.Z> [stale X.Y.Z]: the version's section in place of an old one (and of the
# stale untagged version's), or above the newest release.
write_section() {
    local version="$1" stale="${2:-$1}" fresh work
    [ -f "$CHANGELOG" ] || rebuild
    fresh="$(mktemp)"; work="$(mktemp)"
    section_of "$version" > "$fresh"
    awk -v want="## [$version]" -v stale="## [$stale]" -v fresh="$fresh" '
        function put() { while ((getline line < fresh) > 0) print line; print ""; written = 1 }
        /^## / {
            skipping = 0
            if (index($0, "## [Unreleased]") == 1 || index($0, stale) == 1) { skipping = 1; next }
            if (index($0, want) == 1) { skipping = 1; if (!written) put(); next }
            if (!written) put()
        }
        skipping { next }
        { print }
        END { if (!written) { print ""; put() } }
    ' "$CHANGELOG" > "$work"
    awk 'NF { blank = 0; print; next } !blank { blank = 1; print }' "$work" > "$CHANGELOG"
    rm -f "$fresh" "$work"
}

release() {
    local wanted="${1:-auto}" last version stale=""
    last="$(tag_before HEAD)"
    [ -z "$last" ] || [ -n "$(git rev-list "$last..HEAD")" ] || die "there is no commit since $last"
    if [ "v$VERSION" != "$last" ] && ! tag_exists "v$VERSION" \
        && [[ "$wanted" = auto || "$wanted" = "$VERSION" ]]; then
        version="$VERSION"
        echo "changelog: package.json already says $version, past ${last:-no tag}; the version is kept" >&2
    else
        case "$wanted" in
        [0-9]*.[0-9]*.[0-9]*) version="$wanted" ;;
        *) version="$(next "$wanted")" ;;
        esac
        ! tag_exists "v$version" || die "the tag v$version already exists"
        tag_exists "v$VERSION" || stale="$VERSION"
        set_version "$version"
        echo "changelog: package.json now says $version (was $VERSION)" >&2
    fi
    write_section "$version" "$stale"
    echo "changelog: CHANGELOG.md has the section of $version" >&2
    echo "changelog: commit package.json, package-lock.json, the plugin manifest and CHANGELOG.md, then tag v$version and push the tag" >&2
}

case "${1:-}" in
rebuild) rebuild ;;
section) section_of "${2:-$VERSION}" ;;
next)    next "${2:-auto}" ;;
release) release "${2:-auto}" ;;
*) echo "usage: scripts/changelog.sh {rebuild|section [X.Y.Z]|next [level]|release [level|X.Y.Z]}" >&2; exit 2 ;;
esac
