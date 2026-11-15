#!/usr/bin/env bash
# Runs the Android app's instrumented tests against a real machine on this Mac: packages/link/testkit's
# test-machine (the real daemon and the real bridge on its fake backend), whose LAN port is reversed
# into the device with `adb reverse`, so the app dials exactly the route the offer names. The app's
# data is cleared first: the test pairs a phone that has nothing paired. Before the tests the machine
# runs one of its sessions as a terminal would, waiting on a permission, which RealMachineTest
# approves from the inbox. After them the machine stops and the app, left installed with its data,
# starts cold: its inbox must show the cached rows, dimmed. The test's screenshots and the cold
# start's go to the output directory.
#
# Usage: scripts/test-android-real-machine.sh [output directory]   (default apps/android/build/real-machine)
# Needs one booted device or emulator, cargo, Bun with `bun install` in packages/bridge, and
# ANDROID_HOME and JAVA_HOME (JDK 17).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADB="$ANDROID_HOME/platform-tools/adb"
OUT="${1:-$ROOT/apps/android/build/real-machine}"
ASK_TITLE="Clean the build folder"
# The cached row of that session reads as its title, or as its ask while it was waiting.
CACHED_ROW="$ASK_TITLE|wants to run bash"
WORK="$(mktemp -d)"
mkfifo "$WORK/stdin"

(cd "$ROOT/packages/link" && cargo run --quiet --locked -p broski-link-testkit --bin test-machine \
  <"$WORK/stdin" >"$WORK/out") &
MACHINE=$!
exec 3>"$WORK/stdin"
cleanup() {
  exec 3>&-
  wait "$MACHINE" || true
  rm -rf "$WORK"
}
trap cleanup EXIT

until grep -q '"offer"' "$WORK/out" 2>/dev/null; do
  kill -0 "$MACHINE" 2>/dev/null || { echo "error: test-machine exited" >&2; exit 1; }
  sleep 1
done
LINE="$(grep '"offer"' "$WORK/out")"
OFFER="$(sed -n 's/.*"offer":"\([^"]*\)".*/\1/p' <<<"$LINE")"
SERVED="$(sed -n 's/.*"root":"\([^"]*\)".*/\1/p' <<<"$LINE")"
PORT="$(sed -n 's/.*[?&]l=127\.0\.0\.1:\([0-9]*\).*/\1/p' <<<"$OFFER")"
echo "==> test-machine up: LAN port $PORT, serving $SERVED"

echo "{\"seed\":\"$ASK_TITLE\"}" >&3
until grep -q '"seeded"' "$WORK/out"; do sleep 1; done
SESSION="$(grep '"seeded"' "$WORK/out" | sed -n 's/.*"seeded":\({[^}]*}\).*/\1/p')"
echo "{\"run\":$SESSION,\"scenario\":\"permission\"}" >&3
until grep -q '"running"' "$WORK/out"; do sleep 1; done

"$ADB" reverse "tcp:$PORT" "tcp:$PORT"
"$ADB" shell pm clear com.muzammil.broski >/dev/null 2>&1 || true
(cd "$ROOT/apps/android" && ./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true \
  "-Pandroid.testInstrumentationRunnerArguments.offer=$OFFER" \
  "-Pandroid.testInstrumentationRunnerArguments.root=$SERVED")

mkdir -p "$OUT"
"$ADB" pull /sdcard/Android/data/com.muzammil.broski/files/screenshots/. "$OUT/" >/dev/null

echo "==> Stopping the machine, then a cold start of the app"
exec 3>&-
wait "$MACHINE" || true
"$ADB" reverse --remove "tcp:$PORT"
"$ADB" shell am force-stop com.muzammil.broski
"$ADB" shell am start -W -n com.muzammil.broski/.app.MainActivity >/dev/null
for _ in $(seq 20); do
  "$ADB" exec-out uiautomator dump /dev/tty >"$OUT/cold-start.xml" 2>/dev/null || true
  grep -qE "$CACHED_ROW" "$OUT/cold-start.xml" && break
  sleep 1
done
"$ADB" exec-out screencap -p >"$OUT/cold-start.png"
if ! grep -qE "$CACHED_ROW" "$OUT/cold-start.xml"; then
  echo "error: the cold start shows no cached row ($OUT/cold-start.xml)" >&2
  exit 1
fi
echo "==> Cold start with the machine stopped shows the cached inbox: $OUT/cold-start.png"
