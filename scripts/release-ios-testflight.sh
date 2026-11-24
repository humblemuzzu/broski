#!/usr/bin/env bash
# Archives Broski for App Store Connect / TestFlight, exports an App Store IPA, uploads it with
# the `asc` CLI, optionally waits for processing, attaches beta groups, and submits for external
# Beta App Review.
#
# Usage:
#   scripts/release-ios-testflight.sh [--archive] [--wait] [--notes "<text>"] [--group "<name|id>"] [--submit]
#
# Requires:
#   - Xcode + XcodeGen + Rust iOS targets (see CONTRIBUTING.md)
#   - `asc` CLI authenticated (`asc auth doctor`) and `.asc/config.json` with `app_id`
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$ROOT/scripts/lib/broski-core.sh"

upload=1
wait_processing=0
submit_review=0
groups=""
test_notes="Broski 0.1.0 beta: native SwiftUI remote for Claude Code and Pi on macOS. Includes Steer-by-default mid-run messaging, collapsible Worked-for turn summaries, daemon-synced notification switches, Live Activity tracking, workspace files/git/libghostty terminal, voice dictation, and local stats."

while (($# > 0)); do
  case $1 in
    --archive) upload=0 ;;
    --wait) wait_processing=1 ;;
    --submit)
      submit_review=1
      wait_processing=1
      ;;
    --group)
      groups="${2:?missing value for --group}"
      wait_processing=1
      shift
      ;;
    --notes)
      test_notes="${2:?missing value for --notes}"
      shift
      ;;
    -h | --help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "usage: $0 [--archive] [--wait] [--notes \"...\"] [--group \"...\"] [--submit]" >&2
      exit 64
      ;;
  esac
  shift
done

OUT="$ROOT/apps/ios/Broski/build/testflight"
ARCHIVE="$OUT/Broski.xcarchive"
EXPORT="$OUT/export"
DERIVED="$OUT/DerivedData"
APP="$ROOT/apps/ios/Broski"

resolve_team() {
  local team=""
  for cfg in "$APP/Local.xcconfig" "$APP/Signing.xcconfig"; do
    [[ -f $cfg ]] || continue
    team="$(sed -n 's/^ *DEVELOPMENT_TEAM *= *//p' "$cfg" | tail -1 | tr -d '[:space:]')"
    [[ -n $team ]] && break
  done
  echo "$team"
}

TEAM="$(resolve_team)"
if [[ -z $TEAM || $TEAM == "YOUR_APPLE_TEAM_ID" ]]; then
  echo "error: set DEVELOPMENT_TEAM in apps/ios/Broski/Local.xcconfig first." >&2
  exit 1
fi

if ios_core_is_stale; then
  "$ROOT/scripts/build-ios-core.sh"
fi

echo "==> Generating Broski.xcodeproj"
xcodegen generate --spec "$APP/project.yml" --project "$APP" --quiet

BUILD_NUM="$(date +%y%m%d%H%M)"
echo "==> Archiving TestFlight build $BUILD_NUM (team $TEAM)"
rm -rf "$ARCHIVE" "$EXPORT"
mkdir -p "$OUT"
xcodebuild archive -quiet -allowProvisioningUpdates \
  -project "$APP/Broski.xcodeproj" \
  -scheme Broski \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -derivedDataPath "$DERIVED" \
  CURRENT_PROJECT_VERSION="$BUILD_NUM"

cat >"$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>$TEAM</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST

echo "==> Exporting App Store IPA"
xcodebuild -exportArchive -quiet -allowProvisioningUpdates \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT" \
  -exportOptionsPlist "$OUT/ExportOptions.plist"

IPA="$(find "$EXPORT" -maxdepth 1 -name '*.ipa' | head -1)"
if [[ -z $IPA ]]; then
  echo "error: no .ipa produced in $EXPORT" >&2
  exit 1
fi
echo "==> Exported: $IPA"

if ((upload == 0)); then
  exit 0
fi

if ! command -v asc >/dev/null 2>&1; then
  echo "error: asc CLI not found; install it or upload $IPA manually." >&2
  exit 1
fi

APP_ID="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("app_id",""))' "$ROOT/.asc/config.json" 2>/dev/null || true)"
if [[ -z $APP_ID ]]; then
  echo "error: set app_id in .asc/config.json before uploading." >&2
  exit 1
fi

echo "==> Uploading build $BUILD_NUM to App Store Connect (app $APP_ID)"
asc builds upload --app "$APP_ID" --ipa "$IPA"

if ((wait_processing == 1)); then
  echo "==> Waiting for Apple to finish processing build $BUILD_NUM"
  asc builds wait --app "$APP_ID" --build-number "$BUILD_NUM" --platform IOS --timeout 15m --poll-interval 15s
  echo "==> Setting TestFlight What to Test notes"
  asc builds test-notes create --app "$APP_ID" --build-number "$BUILD_NUM" --platform IOS --locale en-US --whats-new "$test_notes"
fi

if [[ -n $groups ]]; then
  echo "==> Attaching build $BUILD_NUM to beta group(s): $groups"
  group_args=(--app "$APP_ID" --build-number "$BUILD_NUM" --platform IOS --group "$groups")
  if ((submit_review == 1)); then
    group_args+=(--submit --confirm)
  fi
  asc builds add-groups "${group_args[@]}"
fi

echo "==> Done: build $BUILD_NUM processed for TestFlight"
