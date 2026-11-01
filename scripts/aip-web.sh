#!/usr/bin/env bash
# Runs `aip web` in the background with a stable link.
# Usage: aip-web.sh restart [port] | stop [port] | status | log
#
# State (pid, port, token, web.log) lives in AIP_WEB_STATE (default: <repo>/.aip/web).
# `stop` without a port and without a port file stops only the process from the pid file;
# it never scans the default port. `stop <port>` and `restart` also stop an `aip web` on the port.
# AIP_WEB_PORT (7341), AIP_WEB_COMMAND (node <repo>/src/cli/main.ts web),
# When the aip daemon serves the panel itself (web.autostart), `aip web` prints its link and exits:
# `restart` returns that link, `status` reads it from $XDG_STATE_HOME/aip/web.json.
# AIP_WEB_TIMEOUT (30 s to wait for the link), AIP_WEB_STOP_TIMEOUT (10 s to wait for exit).
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
state="${AIP_WEB_STATE:-$root/.aip/web}"
default_port="${AIP_WEB_PORT:-7341}"
command_line="${AIP_WEB_COMMAND:-node $root/src/cli/main.ts web}"
start_timeout="${AIP_WEB_TIMEOUT:-30}"
stop_timeout="${AIP_WEB_STOP_TIMEOUT:-10}"

daemon_state="${XDG_STATE_HOME:-$HOME/.local/state}/aip/web.json"
pid_file="$state/pid"
port_file="$state/port"
token_file="$state/token"
log_file="$state/web.log"

alive() { kill -0 "$1" 2>/dev/null; }
command_of() { ps -o command= -p "$1" 2>/dev/null || true; }
# Whether the process command looks like `aip web`.
is_web() { [[ "$(command_of "$1")" == *" web"* ]]; }
# Whether a process found on the port is `aip web` started by hand.
is_manual_web() { command_of "$1" | grep -Eq '(aip|main\.(ts|js)) web'; }

wait_exit() {
  local pid="$1" ticks=$((stop_timeout * 10)) i
  for ((i = 0; i < ticks; i++)); do
    alive "$pid" || return 0
    sleep 0.1
  done
  return 1
}

terminate() {
  local pid="$1"
  kill -TERM "$pid" 2>/dev/null || true
  if ! wait_exit "$pid"; then
    kill -KILL "$pid" 2>/dev/null || true
    wait_exit "$pid" || true
  fi
}

# Stops the process from the pid file. Prints nothing; returns 0 when something was stopped.
stop_own() {
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file")"
  rm -f "$pid_file"
  if [[ "$pid" =~ ^[0-9]+$ ]] && alive "$pid" && is_web "$pid"; then
    terminate "$pid"
    return 0
  fi
  return 1
}

port_pids() {
  command -v lsof >/dev/null 2>&1 || return 0
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true
}

# Stops a manually started `aip web` on the port. With $2 = strict, refuses foreign processes.
stop_port() {
  local port="$1" strict="${2:-}" pid stopped=1
  for pid in $(port_pids "$port"); do
    if is_manual_web "$pid"; then
      terminate "$pid"
      stopped=0
    elif [[ "$strict" == strict ]]; then
      echo "port $port is used by another process: pid $pid: $(command_of "$pid")" >&2
      exit 1
    fi
  done
  return "$stopped"
}

cmd_stop() {
  local port="${1:-}" stopped=1
  if [[ -z "$port" && -f "$port_file" ]]; then
    port="$(cat "$port_file")"
  fi
  stop_own && stopped=0
  if [[ -n "$port" ]]; then
    stop_port "$port" && stopped=0
  fi
  if [[ "$stopped" == 0 ]]; then echo "aip web stopped"; else echo "aip web is not running"; fi
}

# Prints "<url> <pid>" of the panel the aip daemon serves; fails when there is none.
daemon_panel() {
  [[ -f "$daemon_state" ]] || return 1
  node -e '
    const state = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    try { process.kill(state.pid, 0); } catch (error) { if (error.code !== "EPERM") process.exit(1); }
    process.stdout.write(`${state.url} ${state.pid}`);
  ' "$daemon_state" 2>/dev/null
}

# Whether the aip daemon serves the panel on the port.
daemon_serves() {
  local panel
  panel="$(daemon_panel)" || return 1
  [[ "${panel%% *}" == *":$1/"* ]]
}

new_token() {
  node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))"
}

cmd_restart() {
  local port="${1:-$default_port}" token pid i ticks
  mkdir -p "$state"
  stop_own || true
  if ! daemon_serves "$port"; then stop_port "$port" strict || true; fi
  if [[ ! -s "$token_file" ]]; then
    (umask 077 && new_token >"$token_file")
  fi
  chmod 600 "$token_file"
  token="$(cat "$token_file")"
  echo "$port" >"$port_file"
  : >"$log_file"
  # shellcheck disable=SC2086
  AIP_WEB_TOKEN="$token" nohup $command_line --port "$port" </dev/null >>"$log_file" 2>&1 &
  pid=$!
  echo "$pid" >"$pid_file"
  ticks=$((start_timeout * 10))
  for ((i = 0; i < ticks; i++)); do
    if grep -q '^aip web: ' "$log_file"; then
      # The second line of a daemon-served panel follows the link immediately.
      sleep 0.3
      if grep -q '^aip web: served by the aip daemon' "$log_file"; then
        rm -f "$pid_file"
      fi
      grep -m1 '^aip web: ' "$log_file"
      return 0
    fi
    alive "$pid" || break
    sleep 0.1
  done
  if alive "$pid"; then
    echo "aip web did not print its link within ${start_timeout}s" >&2
    terminate "$pid"
  else
    echo "aip web exited before it printed its link" >&2
  fi
  rm -f "$pid_file"
  tail -n 20 "$log_file" >&2 || true
  exit 1
}

cmd_status() {
  local pid
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && alive "$pid" && is_web "$pid"; then
      grep '^aip web: ' "$log_file" | tail -n 1 || true
      echo "pid $pid"
      return 0
    fi
  fi
  local panel
  if panel="$(daemon_panel)"; then
    echo "aip web: ${panel%% *}"
    echo "served by the aip daemon (pid ${panel##* })"
    return 0
  fi
  echo "aip web is not running"
}

cmd_log() {
  if [[ -f "$log_file" ]]; then tail -n 100 "$log_file"; else echo "no log yet: $log_file"; fi
}

case "${1:-}" in
  restart) cmd_restart "${2:-}" ;;
  stop) cmd_stop "${2:-}" ;;
  status) cmd_status ;;
  log) cmd_log ;;
  *)
    echo "usage: $0 restart [port] | stop [port] | status | log" >&2
    exit 2
    ;;
esac
