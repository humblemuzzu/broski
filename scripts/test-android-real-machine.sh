#!/usr/bin/env bash
# Runs the Android app's instrumented tests against a real machine on this Mac: packages/link/testkit's
# test-machine (the real daemon and the real bridge on its fake backend), whose LAN port is reversed
# into the device with `adb reverse`, so the app dials exactly the route the offer names. The app's
# data is cleared first: the test pairs a phone that has nothing paired.
#
# Usage: scripts/test-android-real-machine.sh
# Needs one booted device or emulator, cargo, Bun with `bun install` in packages/bridge, and
# ANDROID_HOME and JAVA_HOME (JDK 17).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADB="$ANDROID_HOME/platform-tools/adb"
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

"$ADB" reverse "tcp:$PORT" "tcp:$PORT"
"$ADB" shell pm clear com.muzammil.broski >/dev/null 2>&1 || true
(cd "$ROOT/apps/android" && ./gradlew :app:connectedDebugAndroidTest \
  "-Pandroid.testInstrumentationRunnerArguments.offer=$OFFER" \
  "-Pandroid.testInstrumentationRunnerArguments.root=$SERVED")
"$ADB" reverse --remove "tcp:$PORT"
