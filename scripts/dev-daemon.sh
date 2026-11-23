#!/usr/bin/env bash
# Single entrypoint for running, replacing, stopping or inspecting the local dev broski-link daemon
# and its supervised bridge on this Mac. Guarantees only one daemon and one bridge exist at a time,
# stopping any prior or stray daemon/bridge processes while sparing live Pi session holders.
#
# Usage:
#   scripts/dev-daemon.sh [restart|start|stop|status] [--build] [--all]
#     restart (default)  stop any running/stray daemon + bridge, rebuild daemon if stale (or --build),
#                        start one clean tmux session `broski-daemon`, wait for `bridge up`
#     start              same as restart (never spawns a second instance)
#     stop               stop `broski-daemon`, stray daemon/bridge processes, and `broski-phone`;
#                        pass --all to also stop live Pi holders under ~/.broski/pi-hosts
#     status             show broski-link status, active Broski processes, booted simulators and build sizes
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
LINK_DIR="$ROOT/packages/link"
# Cargo runs in $LINK_DIR, so a relative CARGO_TARGET_DIR is relative to it.
case "${CARGO_TARGET_DIR:-}" in
  "") LINK_TARGET="$LINK_DIR/target" ;;
  /*) LINK_TARGET="$CARGO_TARGET_DIR" ;;
  *) LINK_TARGET="$LINK_DIR/$CARGO_TARGET_DIR" ;;
esac
DAEMON_BIN="$LINK_TARGET/release/broski-link"
RELAY_BIN="$LINK_TARGET/release/broski-relay"
BRIDGE_ENTRY="$ROOT/packages/bridge/bin/broski.ts"
SESSION="broski-daemon"
RELAY_SESSION="broski-relay"
DEBUG_LOG="/tmp/broski-daemon-debug.log"
RELAY_LOG="/tmp/broski-relay-debug.log"
MAX_LOG_BYTES=$((10 * 1024 * 1024))
LINK_HOME="${BROSKI_LINK_HOME:-$HOME/.broski/link}"

# The port of the local relay the daemon's config names (`ws://127.0.0.1:<port>`), or nothing for a remote one.
local_relay_port() {
  /usr/bin/python3 -c 'import json,re,sys; m=re.fullmatch(r"wss?://127\.0\.0\.1:(\d+)/?", json.load(open(sys.argv[1])).get("relay", "")); print(m.group(1) if m else "")' "$1"
}

relay_healthy() {
  [[ $(curl -fsS --max-time 2 "http://127.0.0.1:$1/healthz" 2>/dev/null || true) == ok ]]
}

cmd=restart
force_build=0
stop_all=0
for arg in "$@"; do
  case $arg in
    restart | start | stop | status) cmd=$arg ;;
    --build) force_build=1 ;;
    --all) stop_all=1 ;;
    -h | --help)
      sed -n '2,13p' "$0"
      exit 0
      ;;
    *)
      echo "usage: $0 [restart|start|stop|status] [--build] [--all]" >&2
      exit 64
      ;;
  esac
done

daemon_is_stale() {
  [[ ! -x $DAEMON_BIN ]] && return 0
  [[ -n $(find \
    "$LINK_DIR/daemon/src" \
    "$LINK_DIR/core/src" \
    "$LINK_DIR/proto/src" \
    "$LINK_DIR/crypto/src" \
    "$LINK_DIR/power/src" \
    "$LINK_DIR/Cargo.lock" \
    -type f -newer "$DAEMON_BIN" -print -quit 2>/dev/null) ]]
}

# Lists PIDs of running broski-link daemon or broski bridge processes, sparing live Pi holders
# (which exist to keep phone-hosted Pi runs alive across bridge restarts) and test-machine helpers.
find_stray_pids() {
  /usr/bin/python3 - "$$" "$PPID" <<'PY'
import glob, json, os, subprocess, sys

self_pids = {int(sys.argv[1]), int(sys.argv[2])}
spared = set(self_pids)

for meta in glob.glob(os.path.expanduser("~/.broski/pi-hosts/*/holder.json")):
    try:
        data = json.load(open(meta))
        for key in ("pid", "piPid"):
            val = data.get(key)
            if isinstance(val, int) and val > 0:
                spared.add(val)
    except Exception:
        pass

out = subprocess.check_output(["ps", "-ax", "-o", "pid=,command="], text=True)
found = []
for line in out.splitlines():
    parts = line.strip().split(None, 1)
    if len(parts) != 2:
        continue
    pid = int(parts[0])
    cmd = parts[1]
    if pid in spared or "__pi-holder" in cmd or cmd.startswith("tmux "):
        continue
    if "broski-link run" in cmd or "packages/bridge/bin/broski.ts" in cmd or "packages/bridge/src/index.ts" in cmd:
        found.append(pid)

for pid in sorted(set(found)):
    print(pid)
PY
}

wait_pids_gone() {
  local seconds=$1
  shift
  local pids=("$@")
  ((${#pids[@]} == 0)) && return 0
  for _ in $(seq $((seconds * 10))); do
    local alive=0
    for pid in "${pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        alive=1
        break
      fi
    done
    ((alive == 0)) && return 0
    sleep 0.1
  done
  return 1
}

stop_existing() {
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    local pane_pids=()
    while IFS= read -r pid; do
      [[ -n $pid ]] && pane_pids+=("$pid")
    done < <(tmux list-panes -t "$SESSION" -F '#{pane_pid}' 2>/dev/null || true)
    for pid in "${pane_pids[@]}"; do
      kill -TERM "$pid" 2>/dev/null || true
    done
    wait_pids_gone 3 "${pane_pids[@]}" || true
    tmux kill-session -t "$SESSION" 2>/dev/null || true
  fi

  local strays=()
  while IFS= read -r pid; do
    [[ -n $pid ]] && strays+=("$pid")
  done < <(find_stray_pids)

  if ((${#strays[@]} > 0)); then
    echo "==> Stopping previous daemon/bridge processes: ${strays[*]}"
    for pid in "${strays[@]}"; do
      kill -TERM "$pid" 2>/dev/null || true
    done
    if ! wait_pids_gone 3 "${strays[@]}"; then
      for pid in "${strays[@]}"; do
        kill -KILL "$pid" 2>/dev/null || true
      done
      wait_pids_gone 2 "${strays[@]}" || true
    fi
  fi
}

rotate_debug_log() {
  if [[ -f $DEBUG_LOG ]]; then
    local size
    size="$(stat -f%z "$DEBUG_LOG" 2>/dev/null || stat -c%s "$DEBUG_LOG" 2>/dev/null || echo 0)"
    if ((size > MAX_LOG_BYTES)); then
      : >"$DEBUG_LOG"
    fi
  fi
}

print_status() {
  echo "=== broski-link status ==="
  if [[ -x $DAEMON_BIN ]]; then
    "$DAEMON_BIN" status 2>&1 || true
  else
    echo "broski-link release binary not built ($DAEMON_BIN)"
  fi

  local cfg="$LINK_HOME/config.json" port
  port="$([[ -f $cfg ]] && local_relay_port "$cfg" || true)"
  if [[ -n $port ]]; then
    echo ""
    if relay_healthy "$port"; then echo "local relay  127.0.0.1:$port up"; else echo "local relay  127.0.0.1:$port DOWN: no push notification can be sent"; fi
  fi

  echo ""
  echo "=== Broski processes ==="
  ps -ax -o pid=,ppid=,etime=,command= | grep -E 'broski-link run|broski-relay|packages/bridge/bin/broski\.ts|packages/bridge/src/index\.ts|__pi-holder|test-machine|dev-fake-bridge|phone-install-server' | grep -v grep || echo "(none)"

  echo ""
  echo "=== tmux sessions ==="
  tmux list-sessions 2>/dev/null | grep -E '^broski-' || echo "(none)"

  if command -v xcrun >/dev/null 2>&1; then
    echo ""
    echo "=== Booted iOS simulators ==="
    xcrun simctl list devices booted 2>/dev/null | grep -E 'Booted' || echo "(none)"
  fi
}

if [[ $cmd == status ]]; then
  print_status
  exit 0
fi

if [[ $cmd == stop ]]; then
  stop_existing
  if tmux has-session -t "$RELAY_SESSION" 2>/dev/null; then
    echo "==> Stopping $RELAY_SESSION"
    tmux kill-session -t "$RELAY_SESSION" 2>/dev/null || true
  fi
  if tmux has-session -t broski-phone 2>/dev/null; then
    echo "==> Stopping broski-phone OTA server"
    tmux kill-session -t broski-phone 2>/dev/null || true
  fi
  if ((stop_all == 1)); then
    echo "==> Stopping live Pi holders"
    (cd "$ROOT/packages/bridge" && bun bin/broski.ts stop) || true
  fi
  echo "==> Stopped"
  exit 0
fi

# The relay sends every push; a daemon whose relay cannot start must not look healthy.
ensure_local_relay() {
  local cfg="$LINK_HOME/config.json"
  local apns_key="$LINK_HOME/apns.p8"
  local apns_meta="$LINK_HOME/apns.json"
  [[ -f $cfg && -f $apns_key && -f $apns_meta ]] || return 0
  local port
  port="$(local_relay_port "$cfg")"
  [[ -n $port ]] || return 0
  if [[ ! -x $RELAY_BIN ]]; then
    echo "==> Building broski-relay (release)"
    (cd "$LINK_DIR" && cargo build --release --locked -p broski-relay)
  fi
  relay_healthy "$port" && return 0
  tmux kill-session -t "$RELAY_SESSION" 2>/dev/null || true
  local holder
  holder="$({ lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true; } | awk 'NR > 1 { print $1 " (pid " $2 ")"; exit }')"
  if [[ -n $holder ]]; then
    echo "error: 127.0.0.1:$port, where the relay belongs, is held by $holder, so no push notification can be sent." >&2
    echo "       Stop it, or point \"relay\" in $cfg at a free port (ws://127.0.0.1:<port>)." >&2
    exit 1
  fi
  local key_id team_id topic sandbox_flag=""
  key_id="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["keyId"])' "$apns_meta")"
  team_id="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["teamId"])' "$apns_meta")"
  topic="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["topic"])' "$apns_meta")"
  if /usr/bin/python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("sandbox") else 1)' "$apns_meta"; then
    sandbox_flag="--apns-sandbox"
  fi
  echo "==> Starting local $RELAY_SESSION (127.0.0.1:$port)"
  tmux new-session -d -s "$RELAY_SESSION" -c "$HOME" \
    "exec env RUST_LOG='info,broski_relay=debug' '$RELAY_BIN' --listen 127.0.0.1:$port --db '$LINK_HOME/relay.db' --apns-key '$apns_key' --apns-key-id '$key_id' --apns-team-id '$team_id' --apns-topic '$topic' $sandbox_flag >> '$RELAY_LOG' 2>&1"
  for _ in $(seq 20); do
    relay_healthy "$port" && return 0
    sleep 0.25
  done
  echo "error: the local relay did not come up on 127.0.0.1:$port; recent log:" >&2
  tail -n 10 "$RELAY_LOG" >&2 || true
  exit 1
}

if ((force_build == 1)) || daemon_is_stale; then
  echo "==> Building broski-link (release)"
  (cd "$LINK_DIR" && cargo build --release --locked -p broski-link-daemon)
fi

ensure_local_relay
stop_existing
rotate_debug_log

echo "==> Starting single broski-daemon tmux session"
tmux new-session -d -s "$SESSION" -c "$HOME" \
  "exec env RUST_LOG='info,broski_link_daemon=debug,broski_link::bridge_process=debug,mdns_sd=warn' '$DAEMON_BIN' run --bridge-cmd '$BRIDGE_ENTRY' --daemon >> '$DEBUG_LOG' 2>&1"

for _ in $(seq 40); do
  if status_out="$("$DAEMON_BIN" status 2>/dev/null)" && grep -qE '^bridge[[:space:]]+up$' <<<"$status_out"; then
    echo "$status_out"
    echo ""
    echo "==> Active processes:"
    ps -ax -o pid=,ppid=,command= | grep -E 'broski-link run|packages/bridge/bin/broski\.ts' | grep -v grep || true
    exit 0
  fi
  sleep 0.5
done

echo "error: broski-link did not report bridge up within 20s; recent log:" >&2
tail -n 30 "$DEBUG_LOG" >&2 || true
exit 1
