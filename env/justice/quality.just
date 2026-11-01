# Install dependencies from package-lock.json
[group('quality')]
install:
    {{ NPM }} ci

# Format all files with prettier
[group('quality')]
fmt:
    {{ NPM }} run format

# Check formatting without changing files
[group('quality')]
fmt-check:
    {{ NPX }} prettier --check .

# Type-check the sources and the web panel
[group('quality')]
typecheck:
    {{ NPM }} run typecheck

# Run vitest (extra arguments are passed through)
[group('quality')]
test *args:
    {{ NPX }} vitest run {{ args }}

# The gate: prettier --check, tsc, vitest
[group('quality')]
check:
    {{ NPM }} run check
