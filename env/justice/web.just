# Build only the web panel into dist/web
[group('web')]
web-build:
    {{ NPX }} vite build --config web/vite.config.ts

# Rebuild the web panel and restart the background aip web
[group('web')]
web port=WEB_PORT: web-build
    scripts/aip-web.sh restart {{ port }}

# Restart the background aip web without rebuilding
[group('web')]
web-restart port=WEB_PORT:
    scripts/aip-web.sh restart {{ port }}

# Stop the background aip web
[group('web')]
web-stop:
    scripts/aip-web.sh stop

# Show the link and pid of the background aip web
[group('web')]
web-status:
    scripts/aip-web.sh status

# Print the log of the background aip web
[group('web')]
web-log:
    scripts/aip-web.sh log

# Run the vite dev server proxied to the background aip web
[group('web')]
web-dev:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! scripts/aip-web.sh status | grep -q '^pid '; then
        echo "aip web is not running: start it with 'just web-restart'" >&2
        exit 1
    fi
    state="${AIP_WEB_STATE:-.aip/web}"
    AIP_WEB_URL="http://127.0.0.1:$(cat "$state/port")" AIP_WEB_TOKEN="$(cat "$state/token")" \
        {{ NPX }} vite --config web/vite.config.ts
