#!/usr/bin/env bash
# Runs the iOS app against a real machine on this Mac: packages/link/testkit's test-machine (the
# real daemon and the real bridge on its fake backend) with four sessions in its history, a fresh
# install of the app in the simulator with the machine's pairing link on its pasteboard, and the
# BroskiE2E scheme's UI tests, which pair from the pasted link, add a session through the machine,
# pull the inbox to refresh, approve a permission the machine asks for from its inbox row, start a held
# run from the chat's composer, follow it in the Live Activity and stop it from there, drive the chat
# (streamed work, permissions, a choice, a queue, Stop, jump to latest, rename, a new session), browse,
# diff, stage and commit in a git repository made in the served root, type into a terminal, dictate
# into a chat (the Mac speaks a line into its own microphone), and save a screenshot of every screen. A second test machine serves `SessionMachineTests`, whose own phone
# follows real runs and holds the chat's session state equal to the core's view after every update.
# Then it puts the push fixture's machine record in the app's keychain,
# sends the fixture push with `simctl push` (which runs no notification service extension) and has
# the notification test deny it from Notification Center.
# The test daemon never advertises itself, so this script advertises its LAN port as the daemon does
# (`_broski-link._tcp`, TXT `id` and `v=1`), and checks the app's log for the LAN browse, the
# answered pull, the stop and the decision.
#
# Usage: scripts/e2e-ios-app.sh [output directory]   (default apps/ios/Broski/build/e2e)
# BROSKI_SIMULATOR names the simulator whose model and iOS the run copies (default "iPhone Duo"):
# every run makes a new simulator of that kind and deletes it at exit, because an uninstall
# leaves the app's notification answer behind (no simctl service resets it), which would skip the
# pairing test's notification ask. BROSKI_E2E_ONLY names UI tests to run alone
# ("Class/testName", space separated; the first, PairingEndToEndTests/test1…, pairs the phone).
# BROSKI_E2E_XAI_KEY, when set, is saved in Settings › Voice so dictation goes through xAI; without it
# the simulator's own recognizer transcribes. Needs what scripts/build-ios-app.sh needs, plus Bun and
# `bun install` in packages/bridge.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/apps/ios/Broski"
OUT="${1:-$APP/build/e2e}"
TEMPLATE="${BROSKI_SIMULATOR:-iPhone Duo}"
SIMULATOR=""

WORK="$(mktemp -d)"
COMMANDS="$WORK/commands"
MACHINE_OUT="$WORK/machine.out"
REPLICA_COMMANDS="$WORK/replica-commands"
REPLICA_OUT="$WORK/replica.out"
: >"$COMMANDS"
: >"$REPLICA_COMMANDS"
mkfifo "$WORK/input" "$WORK/replica-input"
tail_pid=""
machine_pid=""
replica_tail_pid=""
replica_pid=""
advert_pid=""
pusher_pid=""
speaker_pid=""
log_pid=""

stop_pid() {
  local pid=$1
  [[ -z $pid ]] && return 0
  if kill -0 "$pid" 2>/dev/null; then
    for _ in $(seq 30); do
      kill -0 "$pid" 2>/dev/null || return 0
      sleep 0.1
    done
    kill -TERM "$pid" 2>/dev/null || true
    sleep 0.5
    kill -KILL "$pid" 2>/dev/null || true
  fi
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  [[ -n $log_pid ]] && kill "$log_pid" 2>/dev/null || true
  [[ -n $pusher_pid ]] && kill "$pusher_pid" 2>/dev/null || true
  [[ -n $speaker_pid ]] && kill "$speaker_pid" 2>/dev/null || true
  [[ -n $advert_pid ]] && kill "$advert_pid" 2>/dev/null || true
  # Closing the machine's stdin stops it, and with it the daemon and the bridge.
  [[ -n $tail_pid ]] && kill "$tail_pid" 2>/dev/null || true
  [[ -n $replica_tail_pid ]] && kill "$replica_tail_pid" 2>/dev/null || true
  stop_pid "$machine_pid"
  stop_pid "$replica_pid"
  if [[ -n $SIMULATOR ]]; then
    xcrun simctl shutdown "$SIMULATOR" 2>/dev/null || true
    xcrun simctl delete "$SIMULATOR" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

wait_for_lines() {
  local pattern=$1 count=$2 seconds=$3 output=${4:-$MACHINE_OUT} pid=${5:-$machine_pid}
  for _ in $(seq "$seconds"); do
    if (($(grep -c "$pattern" "$output" || true) >= count)); then return 0; fi
    if ! kill -0 "$pid" 2>/dev/null; then
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
served="$(grep '"offer"' "$MACHINE_OUT" | head -1 | /usr/bin/python3 -c 'import json, sys; print(json.load(sys.stdin)["root"])')"

echo '{"seed":"Fix the flaky login test"}' >>"$COMMANDS"
echo '{"seed":"Rename the settings screen"}' >>"$COMMANDS"
echo '{"seed":"Hold for the live activity"}' >>"$COMMANDS"
echo '{"seed":"Clean the build folder"}' >>"$COMMANDS"
echo '{"seed":"Tidy the release notes"}' >>"$COMMANDS"
echo '{"seed":"Read the whole history"}' >>"$COMMANDS"
wait_for_lines '"seeded"' 6 60
# The third session's next run streams, then holds until released: the Live Activity's run.
held="$(grep '"seeded"' "$MACHINE_OUT" | sed -n 3p | /usr/bin/python3 -c 'import json, sys; print(json.dumps(json.load(sys.stdin)["seeded"]))')"
echo "{\"script\":$held,\"scenario\":\"hold\"}" >>"$COMMANDS"
wait_for_lines '"scripted"' 1 60

echo "==> Making $served/project a git repository"
project="$served/project"
mkdir -p "$project"
git -C "$project" init --quiet --initial-branch=main
git -C "$project" config user.name "Broski E2E"
git -C "$project" config user.email "e2e@broski.invalid"
printf 'one\n' >"$project/notes.md"
git -C "$project" add notes.md
git -C "$project" commit --quiet -m "First notes"
git -C "$project" branch feature
printf 'two\n' >>"$project/notes.md"
printf 'buy milk\n' >"$project/todo.txt"
seeded() {
  grep '"seeded"' "$MACHINE_OUT" | sed -n "$1p" | /usr/bin/python3 -c '
import json, sys
print(json.dumps(json.load(sys.stdin)["seeded"], separators=(",", ":")))
'
}
# The fourth session is the one a UI test makes ask for a permission, as a terminal would; the fifth
# is the chat's, whose tests script each of its runs.
ask_session="$(seeded 4)"
chat_session="$(seeded 5)"
# The sixth gets a long history for the scrolling test: 40 runs of `work`, one after another, as a
# terminal starts them.
long_session="$(seeded 6)"
for run in $(seq 40); do
  echo "{\"run\":$long_session,\"scenario\":\"work\"}" >>"$COMMANDS"
  wait_for_lines '"running"' "$run" 60
done

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

echo "==> Making a fresh simulator like $TEMPLATE"
read -r device_type runtime < <(xcrun simctl list devices --json | /usr/bin/python3 -c '
import json, sys
name = sys.argv[1]
for runtime, devices in json.load(sys.stdin)["devices"].items():
    for device in devices:
        if device["name"] == name or device["udid"] == name:
            print(device["deviceTypeIdentifier"], runtime)
            raise SystemExit
sys.exit("error: no simulator named " + name)
' "$TEMPLATE")
SIMULATOR="$(xcrun simctl create "Broski E2E $$" "$device_type" "$runtime")"
xcrun simctl bootstatus "$SIMULATOR" -b >/dev/null
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
# The app's log is streamed while the tests run: `log show` afterwards misses info messages the
# simulator kept only in memory.
xcrun simctl spawn "$SIMULATOR" log stream --level info --style compact \
  --predicate 'subsystem == "com.muzammil.broski"' >"$OUT/app.log" 2>/dev/null &
log_pid=$!
# VoiceEndToEndTests asks for speech by leaving speak-now in the screenshots folder: the Mac says a
# line through its speakers, which the simulator records through the Mac's microphone.
(
  for _ in $(seq 3600); do
    if [[ -f $OUT/screenshots/speak-now ]]; then
      mv "$OUT/screenshots/speak-now" "$OUT/screenshots/spoken"
      sleep 1
      say "Rename the settings screen in SwiftUI, then run bun test."
    fi
    sleep 1
  done
) &
speaker_pid=$!
e2e_tests() {
  TEST_RUNNER_BROSKI_E2E_COMMANDS="$COMMANDS" \
    TEST_RUNNER_BROSKI_E2E_XAI_KEY="${BROSKI_E2E_XAI_KEY:-}" \
    TEST_RUNNER_BROSKI_E2E_SCREENSHOTS="$OUT/screenshots" \
    TEST_RUNNER_BROSKI_E2E_ROOT="$served" \
    TEST_RUNNER_BROSKI_E2E_ASK_SESSION="$ask_session" \
    TEST_RUNNER_BROSKI_E2E_CHAT_SESSION="$chat_session" \
    TEST_RUNNER_BROSKI_E2E_LONG_SESSION="$long_session" \
    xcodebuild test \
    -project "$APP/Broski.xcodeproj" \
    -scheme BroskiE2E \
    -destination "platform=iOS Simulator,id=$SIMULATOR" \
    -derivedDataPath "$APP/build/DerivedData-e2e" \
    "$@"
}
only_testing=()
for test in ${BROSKI_E2E_ONLY:-}; do only_testing+=("-only-testing:BroskiUITests/$test"); done
e2e_tests -skip-testing:BroskiUITests/NotificationEndToEndTests ${only_testing[@]+"${only_testing[@]}"} -resultBundlePath "$OUT/E2E.xcresult"

# Started only now: its pairing offer expires while the UI tests run.
echo "==> Starting the replica test's machine"
tail -f "$REPLICA_COMMANDS" >"$WORK/replica-input" &
replica_tail_pid=$!
(cd "$ROOT/packages/link" && exec cargo run --quiet --locked -p broski-link-testkit --bin test-machine) \
  <"$WORK/replica-input" >"$REPLICA_OUT" &
replica_pid=$!
wait_for_lines '"offer"' 1 600 "$REPLICA_OUT" "$replica_pid"
replica_offer="$(grep '"offer"' "$REPLICA_OUT" | head -1 | sed -E 's/.*"offer":"([^"]*)".*/\1/')"
replica_root="$(grep '"offer"' "$REPLICA_OUT" | head -1 | /usr/bin/python3 -c 'import json, sys; print(json.load(sys.stdin)["root"])')"

echo "==> Following real runs into the chat's session state"
TEST_RUNNER_BROSKI_REPLICA_OFFER="$replica_offer" \
  TEST_RUNNER_BROSKI_REPLICA_ROOT="$replica_root" \
  TEST_RUNNER_BROSKI_REPLICA_COMMANDS="$REPLICA_COMMANDS" \
  TEST_RUNNER_BROSKI_REPLICA_OUTPUT="$REPLICA_OUT" \
  xcodebuild test \
  -project "$APP/Broski.xcodeproj" \
  -scheme Broski \
  -destination "platform=iOS Simulator,id=$SIMULATOR" \
  -derivedDataPath "$APP/build/DerivedData-e2e" \
  -only-testing:BroskiTests/SessionMachineTests \
  -resultBundlePath "$OUT/Replica.xcresult"

echo "==> Putting the push fixture's machine record in the app's keychain"
TEST_RUNNER_BROSKI_E2E_INSTALL_PUSH_RECORD=1 xcodebuild test \
  -project "$APP/Broski.xcodeproj" \
  -scheme Broski \
  -destination "platform=iOS Simulator,id=$SIMULATOR" \
  -derivedDataPath "$APP/build/DerivedData-e2e" \
  -only-testing:BroskiTests/PushFixtureInstall \
  -resultBundlePath "$OUT/PushRecord.xcresult"

# The relay's APNs body (relay/src/push/apns.rs) around the core's pinned push vector, sent once
# the notification test has the app in the background and asks for it. `simctl push` runs no
# notification service extension, so the body also carries what the extension adds for the push
# vector's plaintext (machine, backend, session, request; Tests/PushTests prove the extension's
# content from the same vector).
fixtures="$ROOT/packages/link/mobile/tests/fixtures"
printf '{"aps":{"alert":{"title":"Broski","body":"New activity"},"mutable-content":1,"category":"approval","sound":"default"},"m":"%s","k":"approval","e":"%s","machine":"%s","backend":"claude-code","session":"s-1","request":"req-1"}' \
  "$(/usr/bin/python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["id"])' "$fixtures/push-record.json")" \
  "$(tr -d '\n' <"$fixtures/push.txt")" \
  "$(/usr/bin/python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["id"])' "$fixtures/push-record.json")" \
  >"$WORK/push.apns"
(
  for _ in $(seq 300); do
    if [[ -f $OUT/screenshots/push-now ]]; then
      xcrun simctl push "$SIMULATOR" com.muzammil.broski "$WORK/push.apns"
      exit 0
    fi
    sleep 1
  done
) &
pusher_pid=$!
echo "==> Running the notification test"
e2e_tests -only-testing:BroskiUITests/NotificationEndToEndTests -resultBundlePath "$OUT/Notification.xcresult"
wait "$pusher_pid"
rm -f "$OUT/screenshots/push-now"
echo "==> Screenshots in $OUT/screenshots"

kill "$log_pid"
app_log="$(cat "$OUT/app.log")"
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

stopped="$(grep "a run was stopped from the Live Activity" <<<"$app_log" || true)"
if [[ -z $stopped ]]; then
  echo "error: Stop on the Live Activity never reached the core" >&2
  exit 1
fi
echo "==> Live Activity stop: ${stopped##*] }"

decided="$(grep "a decision was not sent\|a decision reached the relay" <<<"$app_log" || true)"
if [[ -z $decided ]]; then
  echo "error: Deny on the notification never ran the decision" >&2
  exit 1
fi
echo "==> Notification decision: ${decided##*] }"
