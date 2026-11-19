#!/usr/bin/env bash
# Audits and cleans Broski build caches, ad-hoc build copies, stray test servers and idle simulators
# so disk usage and background CPU stay bounded while working.
#
# Usage:
#   scripts/clean-workspace.sh            # report sizes and active processes without deleting anything
#   scripts/clean-workspace.sh --apply    # remove ad-hoc iOS wifi-*/e2e/debug junk, stop stray test-machines,
#                                         # truncate oversized daemon debug log, shut down idle iOS simulators
#   scripts/clean-workspace.sh --deep     # everything in --apply, plus prune Rust target/debug (keeps release
#                                         # broski-link & mobile slices), iOS DerivedData and Android build/ dirs
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
IOS_BUILD="$ROOT/apps/ios/Broski/build"
LINK_TARGET="$ROOT/packages/link/target"
DEBUG_LOG="/tmp/broski-daemon-debug.log"

mode=check
for arg in "$@"; do
  case $arg in
    --check) mode=check ;;
    --apply) mode=apply ;;
    --deep) mode=deep ;;
    -h | --help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "usage: $0 [--check|--apply|--deep]" >&2
      exit 64
      ;;
  esac
done

report_sizes() {
  echo "=== Repo build & cache sizes ==="
  du -sh \
    "$LINK_TARGET/debug" \
    "$LINK_TARGET/release" \
    "$LINK_TARGET" \
    "$IOS_BUILD" \
    "$ROOT/apps/ios/BroskiCore/BroskiCoreFFI.xcframework" \
    "$ROOT/apps/ios/BroskiPush/BroskiPushFFI.xcframework" \
    "$ROOT/apps/android/app/build" \
    "$ROOT/apps/android/core/build" \
    "$ROOT/apps/android/terminal/build" \
    "$ROOT/packages/bridge/node_modules" \
    "$ROOT/os-p" \
    2>/dev/null | sort -hr || true

  echo ""
  echo "=== External caches (not deleted by this script) ==="
  du -sh \
    "$HOME/Library/Developer/CoreSimulator/Devices" \
    "$HOME/.android/avd" \
    "$HOME/.Trash" \
    "$HOME/.broski/logs" \
    2>/dev/null | sort -hr || true
}

if [[ $mode == check ]]; then
  report_sizes
  echo ""
  "$ROOT/scripts/dev-daemon.sh" status
  exit 0
fi

echo "==> Stopping stray test-machine / dev-fake-bridge processes"
pkill -f 'broski-link-testkit|target/.*/test-machine|scripts/dev-fake-bridge\.ts' 2>/dev/null || true

if command -v xcrun >/dev/null 2>&1; then
  echo "==> Shutting down booted iOS simulators"
  xcrun simctl shutdown all 2>/dev/null || true
fi

echo "==> Cleaning ad-hoc iOS build folders and debug artifacts"
rm -rf \
  "$IOS_BUILD"/wifi-* \
  "$IOS_BUILD"/hang*.txt \
  "$IOS_BUILD/DerivedData-e2e" \
  "$IOS_BUILD/DerivedData-device" \
  "$IOS_BUILD/e2e"

if [[ -f $DEBUG_LOG ]]; then
  size="$(stat -f%z "$DEBUG_LOG" 2>/dev/null || stat -c%s "$DEBUG_LOG" 2>/dev/null || echo 0)"
  if ((size > 10 * 1024 * 1024)); then
    echo "==> Truncating oversized $DEBUG_LOG"
    : >"$DEBUG_LOG"
  fi
fi

if [[ $mode == deep ]]; then
  echo "==> Deep clean: pruning Rust target/debug, iOS DerivedData and Android build dirs"
  rm -rf \
    "$LINK_TARGET/debug" \
    "$IOS_BUILD/DerivedData" \
    "$IOS_BUILD/phone/DerivedData" \
    "$IOS_BUILD/phone/stage" \
    "$IOS_BUILD/phone/Broski.xcarchive" \
    "$IOS_BUILD/phone/export" \
    "$ROOT/apps/android/app/build" \
    "$ROOT/apps/android/core/build" \
    "$ROOT/apps/android/terminal/build" \
    "$ROOT/apps/android/build"
fi

echo ""
report_sizes
