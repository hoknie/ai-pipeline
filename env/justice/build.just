# Build dist/ (tsc and the web panel)
[group('build')]
build:
    {{ NPM }} run build

# Build and link the aip binary globally
[group('build')]
link: build
    {{ NPM }} link
