#!/usr/bin/env bash
# Runs the Android app's instrumented tests against a real machine on this Mac: packages/link/testkit's
# test-machine (the real daemon and the real bridge on its fake backend), whose LAN port is reversed
# into the device with `adb reverse`, so the app dials exactly the route the offer names. The app's
# data is cleared first: the test pairs a phone that has nothing paired. The served directory is made
# a git repository, and scripts/lib/test-machine-control.py, reversed too, passes the tests' commands
# (seed, script, release) to test-machine. Screenshots land in app/build/outputs/real-machine-shots.
#
# Usage: scripts/test-android-real-machine.sh
# Needs one booted device or emulator (or ANDROID_SERIAL naming one), cargo, Bun with `bun install` in
# packages/bridge, git, python3, and ANDROID_HOME and JAVA_HOME (JDK 17).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADB="$ANDROID_HOME/platform-tools/adb"
SHOTS="$ROOT/apps/android/app/build/outputs/real-machine-shots"
DEVICE_SHOTS=/sdcard/broski-shots
WORK="$(mktemp -d)"
mkfifo "$WORK/stdin"

(cd "$ROOT/packages/link" && cargo run --quiet --locked -p broski-link-testkit --bin test-machine \
  <"$WORK/stdin" >"$WORK/out") &
MACHINE=$!
exec 3>"$WORK/stdin"
CONTROL_PID=
cleanup() {
  [[ -n $CONTROL_PID ]] && kill "$CONTROL_PID" 2>/dev/null
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

echo "==> Making $SERVED a git repository"
(
  cd "$SERVED"
  export GIT_AUTHOR_NAME=Broski GIT_AUTHOR_EMAIL=tests@broski.invalid
  export GIT_COMMITTER_NAME=Broski GIT_COMMITTER_EMAIL=tests@broski.invalid
  git init --quiet --initial-branch=main
  # The served folder is also the bridge's home: its caches and Broski's own files are not the project.
  printf 'Library/\n.broski/\n' >.gitignore
  mkdir -p src
  printf 'fn main() {\n\tprintln!("hello");\n}\n' >src/main.rs
  printf '# Demo\n\nA repository for the app tests.\n' >README.md
  git add .gitignore README.md src
  git commit --quiet --message "First commit"
  git branch feature
  printf '# Demo\n\nA repository for the app tests, edited.\nAnother line.\n' >README.md
  printf 'notes\n' >untracked.txt
)

CONTROL="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
python3 "$ROOT/scripts/lib/test-machine-control.py" "$WORK/stdin" "$WORK/out" "$CONTROL" &
CONTROL_PID=$!

"$ADB" reverse "tcp:$PORT" "tcp:$PORT"
"$ADB" reverse "tcp:$CONTROL" "tcp:$CONTROL"
"$ADB" shell pm clear com.muzammil.broski >/dev/null 2>&1 || true
"$ADB" shell rm -rf "$DEVICE_SHOTS"
status=0
(cd "$ROOT/apps/android" && ./gradlew :app:connectedDebugAndroidTest \
  "-Pandroid.testInstrumentationRunnerArguments.offer=$OFFER" \
  "-Pandroid.testInstrumentationRunnerArguments.root=$SERVED" \
  "-Pandroid.testInstrumentationRunnerArguments.control=http://127.0.0.1:$CONTROL") || status=$?
"$ADB" reverse --remove "tcp:$PORT"
"$ADB" reverse --remove "tcp:$CONTROL"
rm -rf "$SHOTS"
mkdir -p "$SHOTS"
"$ADB" pull "$DEVICE_SHOTS/." "$SHOTS" >/dev/null 2>&1 && echo "==> Screenshots in $SHOTS"
exit "$status"
