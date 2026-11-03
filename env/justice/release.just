# The version in package.json, the one a release tag must name
[group('release')]
version:
    @scripts/release.sh version

# Check that a tag (vX.Y.Z) names the version in package.json and the plugin manifest
[group('release')]
check-tag tag:
    scripts/release.sh check-tag {{ tag }}

# The npm tarball and SHA256SUMS in dist/release
[group('release')]
pack:
    scripts/release.sh pack

# CHANGELOG.md anew from the commits between v* tags
[group('release')]
changelog:
    scripts/changelog.sh rebuild

# The version the next release takes (auto from the commits, or patch/minor/major)
[group('release')]
next-version level='auto':
    @scripts/changelog.sh next {{ level }}

# Bump the version unless package.json is already past the last tag, then write its CHANGELOG.md section
[group('release')]
release level='auto':
    scripts/changelog.sh release {{ level }}
