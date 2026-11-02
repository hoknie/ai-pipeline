# Development

```sh
npm run check     # prettier --check → tsc → vitest
npm run build
```

The same steps and the panel controls are available through [just](https://github.com/casey/just) (1.27 or newer, needs `bash`; Windows is not supported). The recipes call the npm scripts, so the gate stays the same: `npm run check`.

```sh
just                # list the recipes
just check          # npm run check
just build          # npm run build
just web            # rebuild the frontend (dist/web) and restart aip web in the background
just web-restart    # restart aip web without rebuilding
just web-stop       # stop aip web
just web-status     # link and pid
just web-log        # aip web log
just web-dev        # Vite dev server proxying to the running aip web
```

`just web` keeps `aip web` running in the background on port 7341 (`AIP_WEB_PORT` or a recipe argument). The pid, the log and the token live in `.aip/web/`, so the link does not change between restarts and an open tab keeps working. A restart stops only its own process and an `aip web` you started by hand on that port; a foreign process on the port is left alone. `just web-stop` stops its own process and the `aip web` on the port from `.aip/web/port`. If the recipes did not start the panel, it does not touch processes on the port; to stop someone else's `aip web`, use `scripts/aip-web.sh stop <port>`. The recipes do not restart the `aip` daemon: if it is already running, `aip web` connects to it (and replaces it only if it is older and idle).

