#!/usr/bin/env bash
# Runs the iOS app against a real machine on this Mac: packages/link/testkit's test-machine (the
# real daemon and the real bridge on its fake backend) with two sessions in its history, a fresh
# install of the app in the simulator with the machine's pairing link on its pasteboard, and the
# BroskiE2E scheme's UI tests, which pair from the pasted link, add a session through the machine,
# pull the inbox to refresh, and save a screenshot of every screen. The test daemon never advertises
# itself, so this script advertises its LAN port as the daemon does (`_broski-link._tcp`, TXT `id`
# and `v=1`), and checks that the app's browse found it and that the core answered the pull.
#
# Usage: scripts/e2e-ios-app.sh [output directory]   (default apps/ios/Broski/build/e2e)
# BROSKI_SIMULATOR names the simulator (default "iPhone Duo"); it is erased of the app, its
# keychain and its privacy grants first. Needs what scripts/build-ios-app.sh needs, plus Bun and
# `bun install` in packages/bridge.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/apps/ios/Broski"
OUT="${1:-$APP/build/e2e}"
SIMULATOR="${BROSKI_SIMULATOR:-iPhone Duo}"

WORK="$(mktemp -d)"
COMMANDS="$WORK/commands"
MACHINE_OUT="$WORK/machine.out"
: >"$COMMANDS"
mkfifo "$WORK/input"
tail_pid=""
machine_pid=""
advert_pid=""

cleanup() {
  [[ -n $advert_pid ]] && kill "$advert_pid" 2>/dev/null || true
  # Closing the machine's stdin stops it, and with it the daemon and the bridge.
  [[ -n $tail_pid ]] && kill "$tail_pid" 2>/dev/null || true
  [[ -n $machine_pid ]] && wait "$machine_pid" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

wait_for_lines() {
  local pattern=$1 count=$2 seconds=$3
  for _ in $(seq "$seconds"); do
    if (($(grep -c "$pattern" "$MACHINE_OUT" || true) >= count)); then return 0; fi
    if ! kill -0 "$machine_pid" 2>/dev/null; then
      echo "error: the test machine exited" >&2
      return 1
    fi
    sleep 1
  done
  echo "error: timed out waiting for the test machine ($pattern)" >&2
  return 1
}

echo "==> Starting the test machine"
tail -f "$COMMANDS" >"$WORK/input" &
tail_pid=$!
(cd "$ROOT/packages/link" && exec cargo run --quiet --locked -p broski-link-testkit --bin test-machine) \
  <"$WORK/input" >"$MACHINE_OUT" &
machine_pid=$!
wait_for_lines '"offer"' 1 600
offer="$(grep '"offer"' "$MACHINE_OUT" | head -1 | sed -E 's/.*"offer":"([^"]*)".*/\1/')"

echo '{"seed":"Fix the flaky login test"}' >>"$COMMANDS"
echo '{"seed":"Rename the settings screen"}' >>"$COMMANDS"
wait_for_lines '"seeded"' 2 60

# The machine id is the hex of the fingerprint's first 16 bytes (session/src/pairing.rs).
read -r machine_id lan_port < <(/usr/bin/python3 -c '
import base64, sys, urllib.parse
query = urllib.parse.parse_qs(urllib.parse.urlsplit(sys.argv[1]).query)
fingerprint = base64.urlsafe_b64decode(query["h"][0] + "=" * (-len(query["h"][0]) % 4))
print(fingerprint[:16].hex(), query["l"][0].rsplit(":", 1)[1])
' "$offer")
dns-sd -P "Broski E2E" _broski-link._tcp local. "$lan_port" broski-e2e.local. 127.0.0.1 "id=$machine_id" v=1 \
  >/dev/null &
advert_pid=$!

echo "==> Resetting $SIMULATOR"
xcrun simctl bootstatus "$SIMULATOR" -b >/dev/null
xcrun simctl uninstall "$SIMULATOR" com.muzammil.broski
xcrun simctl keychain "$SIMULATOR" reset
xcrun simctl privacy "$SIMULATOR" reset all com.muzammil.broski
printf '%s' "$offer" | xcrun simctl pbcopy "$SIMULATOR"
# iOS 27 simulators cannot show the paste prompt (SpringBoard refuses to post it for the pasteboard
# daemon), so the read would be refused; `simctl privacy` has no pasteboard service, so the grant
# goes straight into the simulator's TCC database, as Settings' "Paste from Other Apps: Allow" does.
data_path="$(xcrun simctl list devices --json | /usr/bin/python3 -c '
import json, sys
name = sys.argv[1]
for devices in json.load(sys.stdin)["devices"].values():
    for device in devices:
        if device["name"] == name or device["udid"] == name:
            print(device["dataPath"])
            raise SystemExit
' "$SIMULATOR")"
sqlite3 "$data_path/Library/TCC/TCC.db" \
  "INSERT OR REPLACE INTO access (service, client, client_type, auth_value, auth_reason, auth_version, flags)
   VALUES ('kTCCServicePasteboard', 'com.muzammil.broski', 0, 2, 4, 2, 0);"

echo "==> Generating Broski.xcodeproj"
xcodegen generate --spec "$APP/project.yml" --project "$APP" --quiet

rm -rf "$OUT"
mkdir -p "$OUT/screenshots"
echo "==> Running the end-to-end tests"
started="$(date '+%Y-%m-%d %H:%M:%S')"
TEST_RUNNER_BROSKI_E2E_COMMANDS="$COMMANDS" \
  TEST_RUNNER_BROSKI_E2E_SCREENSHOTS="$OUT/screenshots" \
  xcodebuild test \
  -project "$APP/Broski.xcodeproj" \
  -scheme BroskiE2E \
  -destination "platform=iOS Simulator,name=$SIMULATOR" \
  -derivedDataPath "$APP/build/DerivedData-e2e" \
  -resultBundlePath "$OUT/E2E.xcresult"
echo "==> Screenshots in $OUT/screenshots"

app_log="$(xcrun simctl spawn "$SIMULATOR" log show --info --start "$started" --style compact \
  --predicate 'subsystem == "com.muzammil.broski"')"
found="$(grep "machine $machine_id found on the LAN" <<<"$app_log" || true)"
if [[ -z $found ]]; then
  echo "error: the app's LAN browse never reported $machine_id" >&2
  exit 1
fi
echo "==> LAN discovery: ${found##*] }"

refreshed="$(grep "the inbox refresh was answered" <<<"$app_log" || true)"
if [[ -z $refreshed ]]; then
  echo "error: the core never answered the inbox's pull to refresh" >&2
  exit 1
fi
echo "==> Pull to refresh: ${refreshed##*] }"
