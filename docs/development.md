# Development

How to check and build `aip` itself. For using `aip` see the [documentation](README.md).

```sh
npm run check     # prettier --check → tsc → vitest
npm run build
```

These steps and the panel controls are also available through [just](https://github.com/casey/just) (1.27 or newer, needs `bash`; Windows is not supported). The recipes call the npm scripts, so the gate stays the same: `npm run check`.

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

`just web` keeps `aip web` running in the background on port 7341 (`AIP_WEB_PORT` or a recipe argument).

- The pid, the log and the token live in `.aip/web/`, so the link does not change between restarts and an open tab keeps working.
- A restart stops only its own process and an `aip web` you started by hand on that port. A foreign process on the port is left alone.
- `just web-stop` stops its own process and the `aip web` on the port from `.aip/web/port`.
- If the recipes did not start the panel, they do not touch processes on the port. To stop someone else's `aip web`, use `scripts/aip-web.sh stop <port>`.
- The recipes do not restart the `aip` daemon. If it is already running, `aip web` connects to it and replaces it only if it is older and idle.

## Web panel from source

The [panel](web/README.md) is a React application in the `web/` directory. `npm run build` builds it into `dist/web`, from where `aip web` serves it. Without a build, the page tells you to run `npm run build`.

For development, run `aip web` and, in another terminal, the Vite dev server with a proxy to it. Pass the token from the printed link:

```sh
AIP_WEB_URL=http://127.0.0.1:7341 AIP_WEB_TOKEN=<token> npx vite --config web/vite.config.ts
```

## Releases

CI (`.github/workflows/ci.yml`) runs `npm run check` and the build on every push to `main` and on every pull request.

A release publishes `@hoknie/aip` to npm and creates a GitHub Release with the npm tarball, `SHA256SUMS` and the version's section of `CHANGELOG.md`. `CHANGELOG.md` is written from [Conventional Commits](https://www.conventionalcommits.org/) between `v*` tags: `feat` goes to Features, `fix` to Fixes, `type!:` or a `BREAKING CHANGE:` footer to Breaking changes.

While the major version is 0, a breaking change bumps the minor and a feature bumps the patch.

There are two ways to start a release:

- **From GitHub:** Actions → release → Run workflow on `main`, with a level: `auto` (from the commits), `patch`, `minor`, `major` or an exact `X.Y.Z`.

  The workflow bumps the version, writes its changelog section, commits `chore(release): release vX.Y.Z`, tags it, pushes both to `main` and publishes. `main` must accept pushes from `github-actions[bot]`.
- **Locally:**

  ```sh
  just next-version   # the version the next release takes
  just release        # bump package.json, package-lock.json and the plugin manifest, write CHANGELOG.md
  git commit -am "chore(release): release vX.Y.Z"
  git tag vX.Y.Z && git push origin main vX.Y.Z
  ```

  The pushed tag starts the release workflow. It fails if the tag does not name the version in `package.json`.

Other recipes: `just version`, `just check-tag vX.Y.Z`, `just pack` (the tarball and `SHA256SUMS` in `dist/release`) and `just changelog` (rewrites `CHANGELOG.md` from all tags).

The gate and the install check of the packed tarball must pass before anything is published. A tag with a `-` (`v1.2.0-rc.1`) is a prerelease: npm dist-tag `next` and a GitHub prerelease. Re-running a release does not publish to npm again; it updates the GitHub Release.

npm publishing uses trusted publishing: on npmjs.com, configure `@hoknie/aip` to trust the workflow `release.yml` of `hoknie/ai-pipeline` with the environment `release`. Without it, set the secret `NPM_TOKEN` (an npm automation token) in the environment `release`.
